import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PrismaClient, Prisma, DeliveryStatus, KycStatus, ParcelSize, UserRole } from '@prisma/client';
import { z } from 'zod';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

const basePrisma = new PrismaClient();

// Resilient Prisma client with auto-retry for serverless Neon PostgreSQL wakeups and pooler resets
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        let attempts = 3;
        while (attempts > 0) {
          try {
            return await query(args);
          } catch (error: any) {
            const isConnError =
              error?.code === 'P1001' ||
              error?.code === 'P1017' ||
              error?.name === 'PrismaClientInitializationError' ||
              error?.message?.includes("Can't reach database server");

            if (isConnError && attempts > 1) {
              attempts--;
              console.warn(`[Neon DB] Reconnecting on ${operation} (${model ?? 'query'})... retrying in 1.2s`);
              await new Promise(r => setTimeout(r, 1200));
              continue;
            }
            throw error;
          }
        }
      }
    }
  }
});
const app = express();
app.use(cors());
app.use(express.json());

const secret = process.env.JWT_SECRET || 'parcelgo-development-secret-key';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set in environment. Using fallback development secret.');
}

// In-memory event bus for real-time updates (works with or without Redis)
const eventBus = new EventEmitter();
eventBus.setMaxListeners(250);

// Optional Redis client for multi-server deployments
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl
  ? new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true })
  : null;

if (redis && redisUrl) {
  redis.connect().catch(() => console.warn('ℹ️  Redis publisher unavailable; using local in-memory event bus.'));
  
  // Setup subscriber to relay Redis events into local eventBus
  const redisSub = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  redisSub.connect().then(() => {
    redisSub.psubscribe('user:*', 'delivery:*', 'deliveries:*', () => {});
    redisSub.on('pmessage', (_pattern, channel, message) => {
      try {
        const payload = JSON.parse(message);
        eventBus.emit(channel, payload);
      } catch {}
    });
  }).catch(() => {});
}

// Publish real-time events to in-memory bus and Redis
const publish = async (channel: string, payload: unknown) => {
  eventBus.emit(channel, payload);
  if (!redis) return;
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.publish(channel, JSON.stringify(payload));
  } catch (error) {
    // Redis optional in single-node/dev environments
  }
};

const notify = async (userId: string, title: string, body: string) => {
  const notification = await prisma.notification.create({ data: { userId, title, body } });
  await publish(`user:${userId}:notifications`, notification);
  return notification;
};

// Normalize Nigerian and international phone numbers
export function normalizePhone(raw: string): string {
  const cleaned = raw.trim().replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+234')) {
    return '0' + cleaned.slice(4);
  }
  if (cleaned.startsWith('234') && cleaned.length === 13) {
    return '0' + cleaned.slice(3);
  }
  return cleaned;
}

// Helper to reliably extract string params in Express 5
function getParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || '';
  return val ? String(val) : '';
}

// Authenticated Request Interface
export interface AuthRequest extends Request {
  user?: { id: string; role: UserRole };
}

// Authentication & Role-based Authorization Middleware
const auth = (roles?: UserRole[]) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header missing' });
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Token missing' });
    }
    const user = jwt.verify(token, secret) as { id: string; role: UserRole };
    if (roles && !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid authentication token' });
  }
};

// ----------------------------------------------------
// Health Check
// ----------------------------------------------------
app.get('/health', async (_, res) => {
  let dbStatus = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'disconnected';
  }
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    service: 'parcelgo-api',
    database: dbStatus,
    timestamp: new Date().toISOString()
  });
});

// ----------------------------------------------------
// Real-time Server-Sent Events (SSE) Endpoint
// ----------------------------------------------------
app.get('/events', (req: Request, res: Response) => {
  const token = (req.query.token as string) || req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token required for real-time updates' });
  }

  let user: { id: string; role: UserRole };
  try {
    user = jwt.verify(token, secret) as { id: string; role: UserRole };
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Initial connection acknowledgement
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', userId: user.id })}\n\n`);

  const onUserEvent = (payload: unknown) => {
    res.write(`data: ${JSON.stringify({ type: 'NOTIFICATION', payload })}\n\n`);
  };

  const onDeliveryEvent = (payload: unknown) => {
    res.write(`data: ${JSON.stringify({ type: 'DELIVERY_UPDATE', payload })}\n\n`);
  };

  const userNotificationChannel = `user:${user.id}:notifications`;
  const globalDeliveriesChannel = 'deliveries:available';

  eventBus.on(userNotificationChannel, onUserEvent);
  if (user.role === UserRole.RIDER) {
    eventBus.on(globalDeliveriesChannel, onDeliveryEvent);
  }

  // Periodic keepalive comment to prevent socket timeout
  const keepAliveTimer = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    eventBus.off(userNotificationChannel, onUserEvent);
    if (user.role === UserRole.RIDER) {
      eventBus.off(globalDeliveriesChannel, onDeliveryEvent);
    }
  });
});

// ----------------------------------------------------
// Authentication Endpoints
// ----------------------------------------------------
app.post('/auth/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      fullName: z.string().trim().min(2, 'Full name must be at least 2 characters'),
      phone: z.string().trim().min(8, 'Phone number must be at least 8 characters'),
      password: z.string().min(8, 'Password must be at least 8 characters'),
      role: z.nativeEnum(UserRole).optional()
    }).parse(req.body);

    const normalizedPhone = normalizePhone(body.phone);

    const existingUser = await prisma.user.findUnique({
      where: { phone: normalizedPhone }
    });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this phone number already exists. Please sign in.' });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const assignedRole = body.role ?? UserRole.SENDER;
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        phone: normalizedPhone,
        passwordHash,
        role: assignedRole,
        ...(assignedRole === UserRole.RIDER
          ? {
              riderProfile: {
                create: {
                  vehicleType: 'MOTORBIKE',
                  isOnline: true
                }
              }
            }
          : {})
      }
    });

    const token = jwt.sign({ id: user.id, role: user.role }, secret, { expiresIn: '7d' });
    res.status(201).json({
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        kycVerified: user.kycVerified
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post('/auth/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      phone: z.string().trim().min(1, 'Phone number is required'),
      password: z.string().min(1, 'Password is required')
    }).parse(req.body);

    const normalizedPhone = normalizePhone(body.phone);
    const user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });

    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, secret, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        kycVerified: user.kycVerified
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/auth/me', auth(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, fullName: true, phone: true, email: true, role: true, kycVerified: true }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// KYC Endpoints
// ----------------------------------------------------
app.post('/kyc/submit', auth(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      documentType: z.enum(['NIN', 'DRIVERS_LICENSE', 'VOTERS_CARD', 'PASSPORT']),
      providerRef: z.string().min(4, 'ID reference must be at least 4 characters')
    }).parse(req.body);

    const kyc = await prisma.kycVerification.upsert({
      where: { userId: req.user!.id },
      update: { status: KycStatus.PENDING, ...body, submittedAt: new Date(), rejectionReason: null },
      create: { userId: req.user!.id, status: KycStatus.PENDING, ...body, submittedAt: new Date() }
    });
    res.status(202).json(kyc);
  } catch (error) {
    next(error);
  }
});

app.patch('/admin/kyc/:userId', auth([UserRole.ADMIN]), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getParam(req.params.userId);
    const body = z.object({
      status: z.enum(['VERIFIED', 'REJECTED']),
      rejectionReason: z.string().optional()
    }).parse(req.body);

    const kyc = await prisma.$transaction(async tx => {
      const item = await tx.kycVerification.update({
        where: { userId },
        data: {
          status: body.status,
          reviewedAt: new Date(),
          rejectionReason: body.status === 'REJECTED' ? body.rejectionReason : null
        }
      });
      await tx.user.update({
        where: { id: userId },
        data: { kycVerified: body.status === 'VERIFIED' }
      });
      return item;
    });

    await notify(
      userId,
      body.status === 'VERIFIED' ? 'KYC verified' : 'KYC review update',
      body.status === 'VERIFIED' ? 'Your ParcelGo verification is complete.' : 'Your KYC submission needs attention.'
    );
    res.json(kyc);
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// Notifications Endpoints
// ----------------------------------------------------
app.get('/notifications', auth(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(items);
  } catch (error) {
    next(error);
  }
});

app.patch('/notifications/:id/read', auth(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notifId = getParam(req.params.id);
    const updated = await prisma.notification.updateMany({
      where: { id: notifId, userId: req.user!.id },
      data: { readAt: new Date() }
    });
    if (!updated.count) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// Pricing Quote Endpoint
// ----------------------------------------------------
app.post('/pricing/quote', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      distanceKm: z.number().positive('Distance must be positive'),
      parcelSize: z.nativeEnum(ParcelSize),
      speed: z.enum(['STANDARD', 'EXPRESS'])
    }).parse(req.body);

    const multiplier = body.parcelSize === 'DOCUMENT' ? 1 : body.parcelSize === 'SMALL' ? 1.15 : 1.4;
    const baseFee = 120000; // Base: 1,200 NGN in kobo
    const perKmFee = body.distanceKm * 40000; // 400 NGN per km
    const expressFee = body.speed === 'EXPRESS' ? 150000 : 0; // 1,500 NGN
    const feeKobo = Math.round((baseFee + perKmFee + expressFee) * multiplier);

    res.json({
      feeKobo,
      currency: 'NGN',
      estimatedMinutes: body.speed === 'EXPRESS' ? 75 : 180
    });
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// Deliveries Endpoints
// ----------------------------------------------------
app.post('/deliveries', auth([UserRole.SENDER]), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      pickupAddress: z.string().min(3, 'Pickup address is required'),
      dropoffAddress: z.string().min(3, 'Dropoff address is required'),
      receiverName: z.string().min(2, 'Receiver name is required'),
      receiverPhone: z.string().min(8, 'Receiver phone is required'),
      parcelSize: z.nativeEnum(ParcelSize),
      description: z.string().optional(),
      feeKobo: z.number().int().positive()
    }).parse(req.body);

    const trackingCode = `PG-${randomUUID().slice(0, 6).toUpperCase()}`;
    const delivery = await prisma.delivery.create({
      data: {
        ...body,
        trackingCode,
        senderId: req.user!.id,
        events: {
          create: {
            status: DeliveryStatus.PENDING,
            note: 'Delivery request created'
          }
        }
      },
      include: {
        events: { orderBy: { createdAt: 'asc' } }
      }
    });

    // Broadcast new delivery to riders and subscribers
    await publish('deliveries:available', { deliveryId: delivery.id, trackingCode: delivery.trackingCode });
    await publish(`delivery:${delivery.id}`, { type: 'STATUS_CHANGE', delivery });

    res.status(201).json(delivery);
  } catch (error) {
    next(error);
  }
});

app.get('/deliveries/mine', auth([UserRole.SENDER, UserRole.RIDER]), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isRider = req.user!.role === UserRole.RIDER;
    const deliveries = await prisma.delivery.findMany({
      where: isRider ? { riderId: req.user!.id } : { senderId: req.user!.id },
      include: {
        sender: { select: { fullName: true, phone: true } },
        rider: { select: { fullName: true, phone: true } },
        events: { orderBy: { createdAt: 'asc' } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(deliveries);
  } catch (error) {
    next(error);
  }
});

app.get('/deliveries/:trackingCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const trackingCode = getParam(req.params.trackingCode).trim().toUpperCase();
    const delivery = await prisma.delivery.findUnique({
      where: { trackingCode },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        rider: { select: { fullName: true, phone: true } }
      }
    });
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found with this tracking code.' });
    }
    res.json(delivery);
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// Messages & In-App Chat Endpoints
// ----------------------------------------------------
app.get('/deliveries/:id/messages', auth(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deliveryId = getParam(req.params.id);
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { senderId: true, riderId: true }
    });
    if (!delivery || (delivery.senderId !== req.user!.id && delivery.riderId !== req.user!.id)) {
      return res.status(404).json({ error: 'Delivery conversation not found or access denied.' });
    }

    const messages = await prisma.message.findMany({
      where: { deliveryId },
      include: { sender: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' }
    });
    res.json(messages);
  } catch (error) {
    next(error);
  }
});

app.post('/deliveries/:id/messages', auth(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deliveryId = getParam(req.params.id);
    const body = z.object({
      body: z.string().trim().min(1, 'Message body cannot be empty').max(1000)
    }).parse(req.body);

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { senderId: true, riderId: true, trackingCode: true }
    });
    if (!delivery || (delivery.senderId !== req.user!.id && delivery.riderId !== req.user!.id)) {
      return res.status(404).json({ error: 'Delivery conversation not found or access denied.' });
    }

    const message = await prisma.message.create({
      data: {
        deliveryId,
        senderId: req.user!.id,
        body: body.body
      },
      include: { sender: { select: { id: true, fullName: true } } }
    });

    const recipientId = delivery.senderId === req.user!.id ? delivery.riderId : delivery.senderId;
    if (recipientId) {
      await notify(recipientId, 'New delivery message', `New message regarding parcel ${delivery.trackingCode}.`);
    }

    await publish(`delivery:${deliveryId}:messages`, message);
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// Rider Operations Endpoints
// ----------------------------------------------------
app.get('/rider/deliveries/available', auth([UserRole.RIDER]), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const available = await prisma.delivery.findMany({
      where: { status: DeliveryStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 30
    });
    res.json(available);
  } catch (error) {
    next(error);
  }
});

app.patch('/rider/availability', auth([UserRole.RIDER]), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      isOnline: z.boolean(),
      lat: z.number().optional(),
      lng: z.number().optional()
    }).parse(req.body);

    const rider = await prisma.riderProfile.upsert({
      where: { userId: req.user!.id },
      update: { isOnline: body.isOnline, currentLat: body.lat, currentLng: body.lng },
      create: { userId: req.user!.id, isOnline: body.isOnline, currentLat: body.lat, currentLng: body.lng, vehicleType: 'MOTORBIKE' }
    });

    await publish(`riders:${rider.id}`, { type: 'availability', isOnline: body.isOnline });
    res.json(rider);
  } catch (error) {
    next(error);
  }
});

app.post('/rider/deliveries/:id/accept', auth([UserRole.RIDER]), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deliveryId = getParam(req.params.id);
    const delivery = await prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.PENDING },
      data: { riderId: req.user!.id, status: DeliveryStatus.ACCEPTED }
    });

    if (!delivery.count) {
      return res.status(409).json({ error: 'This delivery has already been accepted or is no longer available.' });
    }

    const event = await prisma.deliveryEvent.create({
      data: { deliveryId, status: DeliveryStatus.ACCEPTED, note: 'Rider accepted delivery' }
    });

    const order = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { senderId: true, trackingCode: true }
    });

    if (order) {
      await notify(order.senderId, 'Rider assigned', 'A rider has accepted your delivery and is preparing for pickup.');
    }

    await publish(`delivery:${deliveryId}`, { type: 'status', status: event.status });
    res.json({ id: deliveryId, status: event.status });
  } catch (error) {
    next(error);
  }
});

app.patch('/deliveries/:id/status', auth([UserRole.RIDER]), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deliveryId = getParam(req.params.id);
    const status = z.nativeEnum(DeliveryStatus).parse(req.body.status);
    const updated = await prisma.delivery.updateMany({
      where: { id: deliveryId, riderId: req.user!.id },
      data: { status }
    });

    if (!updated.count) {
      return res.status(404).json({ error: 'Assigned delivery not found.' });
    }

    const event = await prisma.deliveryEvent.create({
      data: { deliveryId, status }
    });

    const order = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { senderId: true, trackingCode: true }
    });

    if (order) {
      const statusLabel = status.toLowerCase().replace('_', ' ');
      await notify(order.senderId, 'Delivery update', `Parcel ${order.trackingCode} is now ${statusLabel}.`);
    }

    await publish(`delivery:${deliveryId}`, { type: 'status', status: event.status });
    res.json({ id: deliveryId, status: event.status });
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// Global Centralized Error Handling Middleware
// ----------------------------------------------------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    const firstIssue = err.issues[0]?.message;
    return res.status(400).json({
      error: firstIssue || 'Invalid request parameters',
      details: err.flatten()
    });
  }

  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P1001' || err.code === 'P1017')) ||
    (err instanceof Error && err.message.includes("Can't reach database server"))
  ) {
    return res.status(503).json({ error: 'Database service is temporarily warming up. Please try again in a moment.' });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[]) || [];
      const fieldName = fields.includes('phone') ? 'Phone number' : fields.includes('email') ? 'Email' : 'Value';
      return res.status(409).json({ error: `${fieldName} is already registered.` });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Requested database record not found.' });
    }
  }

  console.error('Unhandled Server Error:', err);
  return res.status(500).json({ error: 'An unexpected internal server error occurred.' });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ParcelGo API listening on http://0.0.0.0:${PORT} (LAN reachable)`);
});
