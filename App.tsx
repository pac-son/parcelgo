import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  acceptDelivery,
  ApiError,
  createDelivery,
  Delivery,
  DeliveryStatus,
  getAvailableDeliveries,
  getDelivery,
  getMyDeliveries,
  getQuote,
  login,
  register,
  Role,
  Session,
  setRiderAvailability,
  subscribeToRealtime,
  updateDeliveryStatus
} from './src/api';
import { clearSession, loadSession, saveSession } from './src/session';

const green = '#0B5D3B';
const lime = '#D8FF63';
const orange = '#FF7657';

const Icon = ({
  name,
  color = green,
  size = 21
}: {
  name: keyof typeof Ionicons.glyphMap;
  color?: string;
  size?: number;
}) => <Ionicons name={name} color={color} size={size} />;

const money = (kobo: number) => `₦${(kobo / 100).toLocaleString()}`;
const readable = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase());

function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.brandMark}>
        <Text style={styles.markText}>›</Text>
      </View>
      <Text style={styles.brandWord}>
        parcel<Text style={{ color: lime }}>go</Text>
      </Text>
    </View>
  );
}

function Field({
  value,
  onChangeText,
  placeholder,
  secure = false,
  keyboardType = 'default'
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secure?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'email-address';
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#849189"
      secureTextEntry={secure}
      keyboardType={keyboardType}
      style={styles.input}
      autoCapitalize="none"
    />
  );
}

function Button({
  label,
  onPress,
  loading = false,
  subtle = false
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  subtle?: boolean;
}) {
  return (
    <Pressable
      disabled={loading}
      onPress={onPress}
      style={[styles.button, subtle && styles.buttonSubtle]}
    >
      {loading ? (
        <ActivityIndicator color={subtle ? green : '#FFF'} />
      ) : (
        <>
          <Text style={[styles.buttonText, subtle && styles.buttonTextSubtle]}>{label}</Text>
          <Icon name="arrow-forward" color={subtle ? green : '#FFF'} />
        </>
      )}
    </Pressable>
  );
}

// -------------------------------------------------------------------------
// Authentication Screen
// -------------------------------------------------------------------------
function Auth({ onSession }: { onSession: (session: Session) => void }) {
  const [isLogin, setIsLogin] = useState(false);
  const [role, setRole] = useState<Role>('SENDER');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const cleanPhone = phone.trim();
    if (!isLogin && name.trim().length < 2) {
      return Alert.alert('Invalid Name', 'Please enter your full name (at least 2 characters).');
    }
    if (cleanPhone.length < 8) {
      return Alert.alert('Invalid Phone', 'Please enter a valid phone number (e.g. 08012345678 or +2348012345678).');
    }
    if (password.length < 8) {
      return Alert.alert('Weak Password', 'Password must be at least 8 characters long.');
    }

    setSaving(true);
    try {
      const session = isLogin
        ? await login(cleanPhone, password)
        : await register(name.trim(), cleanPhone, password, role);
      await saveSession(session);
      onSession(session);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Please check your connection and credentials.';
      Alert.alert(isLogin ? 'Sign In Failed' : 'Registration Failed', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.auth}>
      <Brand />
      <Text style={styles.authTitle}>{isLogin ? 'Welcome back.' : 'Join ParcelGo'}</Text>
      <Text style={styles.muted}>
        {isLogin
          ? 'Sign in to track deliveries and manage orders in real time.'
          : 'Create your account to start sending or delivering across Nigeria.'}
      </Text>
      <View style={styles.form}>
        {!isLogin && (
          <>
            <Text style={styles.label}>I WANT TO REGISTER AS</Text>
            <View style={styles.roleContainer}>
              <Pressable
                onPress={() => setRole('SENDER')}
                style={[styles.roleCard, role === 'SENDER' && styles.roleCardActive]}
              >
                <Icon
                  name="cube-outline"
                  size={22}
                  color={role === 'SENDER' ? '#FFF' : green}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.roleTitle, role === 'SENDER' && styles.roleTitleActive]}>
                    Sender
                  </Text>
                  <Text style={[styles.roleSubtitle, role === 'SENDER' && styles.roleSubtitleActive]}>
                    Send & track parcels
                  </Text>
                </View>
                {role === 'SENDER' && <Icon name="checkmark-circle" size={18} color={lime} />}
              </Pressable>

              <Pressable
                onPress={() => setRole('RIDER')}
                style={[styles.roleCard, role === 'RIDER' && styles.roleCardActive]}
              >
                <Icon
                  name="bicycle-outline"
                  size={22}
                  color={role === 'RIDER' ? '#FFF' : green}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.roleTitle, role === 'RIDER' && styles.roleTitleActive]}>
                    Dispatch Rider
                  </Text>
                  <Text style={[styles.roleSubtitle, role === 'RIDER' && styles.roleSubtitleActive]}>
                    Accept & deliver orders
                  </Text>
                </View>
                {role === 'RIDER' && <Icon name="checkmark-circle" size={18} color={lime} />}
              </Pressable>
            </View>

            <Field value={name} onChangeText={setName} placeholder="Full name e.g. Tunde Balogun" />
          </>
        )}
        <Field
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone number e.g. 08012345678"
          keyboardType="phone-pad"
        />
        <Field
          value={password}
          onChangeText={setPassword}
          placeholder="Password (at least 8 characters)"
          secure
        />
        <Button label={isLogin ? 'Sign in' : `Create ${role === 'RIDER' ? 'Rider' : 'Sender'} Account`} onPress={submit} loading={saving} />
        <Pressable onPress={() => setIsLogin(!isLogin)}>
          <Text style={styles.switch}>
            {isLogin ? 'New to ParcelGo? Create an account' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.footnote}>
        Live real-time data synced directly with the ParcelGo PostgreSQL cloud backend.
      </Text>
    </ScrollView>
  );
}

// -------------------------------------------------------------------------
// Delivery Card Component
// -------------------------------------------------------------------------
function DeliveryCard({ delivery, onPress }: { delivery: Delivery; onPress?: () => void }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DELIVERED':
        return '#2E7D32';
      case 'IN_TRANSIT':
      case 'PICKED_UP':
        return '#0288D1';
      case 'ACCEPTED':
        return '#F57C00';
      default:
        return '#40A369';
    }
  };

  return (
    <Pressable onPress={onPress} style={styles.deliveryCard}>
      <View style={styles.box}>
        <Icon name="cube-outline" size={25} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTop}>
          <Text style={styles.tracking}>{delivery.trackingCode}</Text>
          <Text style={styles.price}>{money(delivery.feeKobo)}</Text>
        </View>
        <Text style={styles.route} numberOfLines={1}>
          {delivery.pickupAddress} → {delivery.dropoffAddress}
        </Text>
        <View style={styles.status}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(delivery.status) }]} />
          <Text style={[styles.statusText, { color: getStatusColor(delivery.status) }]}>
            {readable(delivery.status)}
          </Text>
          {delivery.rider?.fullName ? (
            <Text style={styles.riderBadge}>• Rider: {delivery.rider.fullName}</Text>
          ) : null}
        </View>
      </View>
      <Icon name="chevron-forward" color="#9AA79F" size={18} />
    </Pressable>
  );
}

// -------------------------------------------------------------------------
// Home Screen
// -------------------------------------------------------------------------
function Home({
  session,
  deliveries,
  availableDeliveries,
  refreshing,
  isLive,
  isOnline,
  onToggleOnline,
  onRefresh,
  onCreate,
  onTrack,
  onAcceptDelivery,
  onUpdateStatus,
  onSignOut
}: {
  session: Session;
  deliveries: Delivery[];
  availableDeliveries: Delivery[];
  refreshing: boolean;
  isLive: boolean;
  isOnline: boolean;
  onToggleOnline: () => void;
  onRefresh: () => void;
  onCreate: () => void;
  onTrack: (tracking: string) => void;
  onAcceptDelivery: (deliveryId: string) => void;
  onUpdateStatus: (deliveryId: string, status: DeliveryStatus) => void;
  onSignOut: () => void;
}) {
  const isRider = session.user.role === 'RIDER';

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.top}>
        <Brand />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.roleBadge}>
            <Icon
              name={isRider ? 'bicycle-outline' : 'cube-outline'}
              size={14}
              color={green}
            />
            <Text style={styles.roleBadgeText}>
              {isRider ? 'Rider Mode' : 'Sender Mode'}
            </Text>
          </View>
          {isLive && (
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
          <Pressable onPress={onSignOut} style={styles.iconButton}>
            <Icon name="log-out-outline" />
          </Pressable>
        </View>
      </View>

      <Text style={styles.kicker}>
        {isRider ? 'DISPATCH RIDER DASHBOARD' : 'WELCOME BACK'}
      </Text>
      <Text style={styles.title}>
        Hi {session.user.fullName.split(' ')[0]}, {isRider ? 'ready to deliver?' : 'where to?'}
      </Text>

      {isRider ? (
        <>
          <View style={styles.riderStatusBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isOnline ? '#2E7D32' : '#9AA79F' }
                ]}
              />
              <Text style={styles.riderStatusText}>
                {isOnline ? 'Online (Accepting orders)' : 'Offline'}
              </Text>
            </View>
            <Pressable
              onPress={onToggleOnline}
              style={[styles.onlineToggleBtn, !isOnline && styles.onlineToggleBtnOff]}
            >
              <Text style={styles.onlineToggleText}>
                {isOnline ? 'Go Offline' : 'Go Online'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>
              Available Orders ({availableDeliveries.length})
            </Text>
            <Pressable onPress={onRefresh}>
              <Text style={styles.link}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
            </Pressable>
          </View>

          {availableDeliveries.length ? (
            availableDeliveries.map(item => (
              <View key={item.id} style={styles.availableCard}>
                <View style={styles.cardTop}>
                  <Text style={styles.tracking}>{item.trackingCode}</Text>
                  <Text style={styles.price}>{money(item.feeKobo)}</Text>
                </View>
                <Text style={styles.route} numberOfLines={1}>
                  📍 {item.pickupAddress}
                </Text>
                <Text style={[styles.route, { marginTop: 4 }]} numberOfLines={1}>
                  🏁 {item.dropoffAddress}
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <Text style={styles.parcelSizeBadge}>
                    📦 {readable(item.parcelSize)}
                  </Text>
                  <Pressable
                    onPress={() => onAcceptDelivery(item.id)}
                    style={styles.acceptBtn}
                  >
                    <Text style={styles.acceptBtnText}>Accept Delivery</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.empty}>
              <Icon name="bicycle-outline" size={28} />
              <Text style={styles.emptyTitle}>No pending orders right now</Text>
              <Text style={styles.emptyText}>
                New orders created by senders will appear here in real time.
              </Text>
            </View>
          )}

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>My Deliveries ({deliveries.length})</Text>
          </View>

          {deliveries.length ? (
            deliveries.map(delivery => (
              <View key={delivery.id} style={{ marginBottom: 12 }}>
                <DeliveryCard
                  delivery={delivery}
                  onPress={() => onTrack(delivery.trackingCode)}
                />
                {delivery.status !== 'DELIVERED' && delivery.status !== 'CANCELLED' && (
                  <View style={styles.riderActionRow}>
                    {delivery.status === 'ACCEPTED' && (
                      <Pressable
                        onPress={() => onUpdateStatus(delivery.id, 'PICKED_UP')}
                        style={styles.actionBtn}
                      >
                        <Text style={styles.actionBtnText}>Confirm Picked Up 📦</Text>
                      </Pressable>
                    )}
                    {delivery.status === 'PICKED_UP' && (
                      <Pressable
                        onPress={() => onUpdateStatus(delivery.id, 'IN_TRANSIT')}
                        style={styles.actionBtn}
                      >
                        <Text style={styles.actionBtnText}>Start In-Transit 🛵</Text>
                      </Pressable>
                    )}
                    {delivery.status === 'IN_TRANSIT' && (
                      <Pressable
                        onPress={() => onUpdateStatus(delivery.id, 'DELIVERED')}
                        style={[styles.actionBtn, { backgroundColor: '#2E7D32' }]}
                      >
                        <Text style={styles.actionBtnText}>Mark Delivered ✅</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            ))
          ) : (
            <View style={styles.empty}>
              <Icon name="cube-outline" size={28} />
              <Text style={styles.emptyTitle}>No active deliveries</Text>
              <Text style={styles.emptyText}>
                Accept an order from the list above to start your route.
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <Button label="Send a parcel" onPress={onCreate} />

          <View style={styles.map}>
            <View style={styles.pin}>
              <Icon name="location" color="#FFF" />
            </View>
            <Text style={styles.mapCaption}>
              {isLive ? '● Real-time Live Tracking Connected' : 'Real-time parcel tracking'}
            </Text>
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Your deliveries</Text>
            <Pressable onPress={onRefresh}>
              <Text style={styles.link}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
            </Pressable>
          </View>

          {deliveries.length ? (
            deliveries.map(delivery => (
              <DeliveryCard
                key={delivery.id}
                delivery={delivery}
                onPress={() => onTrack(delivery.trackingCode)}
              />
            ))
          ) : (
            <View style={styles.empty}>
              <Icon name="cube-outline" size={28} />
              <Text style={styles.emptyTitle}>No deliveries yet</Text>
              <Text style={styles.emptyText}>Create your first parcel delivery to see it track here live.</Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// -------------------------------------------------------------------------
// Create Delivery Screen
// -------------------------------------------------------------------------
function Create({
  token,
  onBack,
  onCreated,
  onSessionExpired
}: {
  token: string;
  onBack: () => void;
  onCreated: (delivery: Delivery) => void;
  onSessionExpired: () => void;
}) {
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [receiver, setReceiver] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [description, setDescription] = useState('');
  const [distanceKm, setDistanceKm] = useState('5');
  const [speed, setSpeed] = useState<'STANDARD' | 'EXPRESS'>('STANDARD');
  const [parcel, setParcel] = useState<'DOCUMENT' | 'SMALL' | 'MEDIUM' | 'LARGE'>('SMALL');
  const [quote, setQuote] = useState<number | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);

  const quoteDelivery = async () => {
    const dist = parseFloat(distanceKm);
    if (isNaN(dist) || dist <= 0) {
      return Alert.alert('Invalid Distance', 'Please enter a valid estimated distance in kilometers.');
    }
    setCalculating(true);
    try {
      const result = await getQuote(dist, parcel, speed);
      setQuote(result.feeKobo);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      Alert.alert('Quote Unavailable', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setCalculating(false);
    }
  };

  const submit = async () => {
    if (!pickup.trim() || !dropoff.trim() || !receiver.trim() || !receiverPhone.trim()) {
      return Alert.alert('Incomplete Details', 'Please complete pickup, destination, and receiver details.');
    }
    if (!quote) {
      return Alert.alert('Calculate Fee First', 'Please tap “Calculate fee” to compute the delivery quote.');
    }

    setSaving(true);
    try {
      const delivery = await createDelivery(token, {
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        receiverName: receiver.trim(),
        receiverPhone: receiverPhone.trim(),
        parcelSize: parcel,
        description: description.trim() || undefined,
        feeKobo: quote
      });
      onCreated(delivery);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      Alert.alert('Could Not Create Delivery', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable onPress={onBack} style={styles.back}>
        <Icon name="arrow-back" />
      </Pressable>
      <Text style={styles.kicker}>NEW DELIVERY</Text>
      <Text style={styles.title}>Send a parcel</Text>
      <Text style={styles.muted}>Enter delivery details for real-time dispatch.</Text>

      <View style={styles.form}>
        <Text style={styles.label}>PICKUP LOCATION</Text>
        <Field value={pickup} onChangeText={setPickup} placeholder="e.g. 14 Adeola Odeku, Victoria Island" />

        <Text style={styles.label}>DROP-OFF DESTINATION</Text>
        <Field value={dropoff} onChangeText={setDropoff} placeholder="e.g. 5 Allen Avenue, Ikeja" />

        <Text style={styles.label}>ESTIMATED DISTANCE (KM)</Text>
        <Field
          value={distanceKm}
          onChangeText={val => {
            setDistanceKm(val);
            setQuote(null);
          }}
          placeholder="Distance in kilometers (e.g. 8)"
          keyboardType="numeric"
        />

        <Text style={styles.label}>DELIVERY SPEED</Text>
        <View style={styles.chips}>
          {(['STANDARD', 'EXPRESS'] as const).map(s => (
            <Pressable
              key={s}
              onPress={() => {
                setSpeed(s);
                setQuote(null);
              }}
              style={[styles.chip, speed === s && styles.chipOn]}
            >
              <Text style={[styles.chipText, speed === s && styles.chipTextOn]}>
                {s === 'EXPRESS' ? '⚡ Express (~75 min)' : '📦 Standard (~3 hrs)'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>RECEIVER DETAILS</Text>
        <Field value={receiver} onChangeText={setReceiver} placeholder="Receiver full name" />
        <Field
          value={receiverPhone}
          onChangeText={setReceiverPhone}
          placeholder="Receiver phone number"
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>PARCEL SIZE</Text>
        <View style={styles.chips}>
          {(['DOCUMENT', 'SMALL', 'MEDIUM', 'LARGE'] as const).map(size => (
            <Pressable
              key={size}
              onPress={() => {
                setParcel(size);
                setQuote(null);
              }}
              style={[styles.chip, parcel === size && styles.chipOn]}
            >
              <Text style={[styles.chipText, parcel === size && styles.chipTextOn]}>
                {readable(size)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field
          value={description}
          onChangeText={setDescription}
          placeholder="Parcel notes / description (optional)"
        />

        <Button
          label={calculating ? 'Calculating…' : quote ? `Calculated Fee: ${money(quote)}` : 'Calculate fee'}
          onPress={quoteDelivery}
          subtle={Boolean(quote)}
          loading={calculating}
        />

        <Button label="Create & Dispatch" onPress={submit} loading={saving} />
      </View>
    </ScrollView>
  );
}

// -------------------------------------------------------------------------
// Live Tracking Screen
// -------------------------------------------------------------------------
function Tracking({
  tracking,
  onBack,
  onSessionExpired
}: {
  tracking?: string;
  onBack: () => void;
  onSessionExpired: () => void;
}) {
  const [code, setCode] = useState(tracking ?? '');
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const find = async (targetCode?: string) => {
    const query = (targetCode || code).trim().toUpperCase();
    if (!query) return;
    setLoading(true);
    try {
      const result = await getDelivery(query);
      setDelivery(result);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      Alert.alert('Parcel Not Found', error instanceof Error ? error.message : 'Please check tracking code.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tracking) find(tracking);
  }, [tracking]);

  // Real-time polling fallback every 8 seconds while on tracking screen
  useEffect(() => {
    const currentCode = (delivery?.trackingCode || tracking || code).trim().toUpperCase();
    if (!currentCode) return;

    const interval = setInterval(async () => {
      try {
        const updated = await getDelivery(currentCode);
        setDelivery(updated);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch {}
    }, 8000);

    return () => clearInterval(interval);
  }, [delivery?.trackingCode, tracking, code]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable onPress={onBack} style={styles.back}>
        <Icon name="arrow-back" />
      </Pressable>
      <Text style={styles.kicker}>LIVE PARCEL TRACKING</Text>
      <Text style={styles.title}>Delivery Status</Text>

      <View style={styles.search}>
        <Field
          value={code}
          onChangeText={setCode}
          placeholder="Tracking code e.g. PG-A1B2C3"
        />
        <Pressable onPress={() => find()} style={styles.searchButton}>
          {loading ? <ActivityIndicator color="#FFF" /> : <Icon name="search" color="#FFF" />}
        </Pressable>
      </View>

      {delivery && (
        <>
          <DeliveryCard delivery={delivery} />

          {delivery.rider && (
            <View style={styles.riderCard}>
              <View style={styles.riderAvatar}>
                <Icon name="bicycle" size={24} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.riderTitle}>Assigned Rider</Text>
                <Text style={styles.riderName}>{delivery.rider.fullName}</Text>
                {delivery.rider.phone && (
                  <Text style={styles.riderPhone}>📞 {delivery.rider.phone}</Text>
                )}
              </View>
            </View>
          )}

          <View style={styles.timeline}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.sectionTitle}>Journey Timeline</Text>
              {lastUpdated && <Text style={styles.liveSync}>Live • {lastUpdated}</Text>}
            </View>

            {(delivery.events ?? []).map((event, index) => (
              <View style={styles.timelineItem} key={`${event.status}-${index}`}>
                <View
                  style={[
                    styles.timelineDot,
                    index === (delivery.events?.length ?? 0) - 1 && styles.timelineDotOn
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.timelineStatus}>{readable(event.status)}</Text>
                  <Text style={styles.timelineNote}>
                    {event.note || new Date(event.createdAt).toLocaleTimeString()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

// -------------------------------------------------------------------------
// Main Root Application
// -------------------------------------------------------------------------
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [availableDeliveries, setAvailableDeliveries] = useState<Delivery[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [screen, setScreen] = useState<'home' | 'create' | 'track'>('home');
  const [tracking, setTracking] = useState<string | undefined>();

  const handleSessionExpired = async () => {
    await clearSession();
    setSession(null);
    setDeliveries([]);
    setAvailableDeliveries([]);
    setIsLive(false);
    Alert.alert('Session Expired', 'Your session has ended. Please sign in again.');
  };

  useEffect(() => {
    loadSession()
      .then(setSession)
      .finally(() => setLoadingSession(false));
  }, []);

  const refreshDeliveries = async () => {
    if (!session) return;
    setRefreshing(true);
    try {
      const list = await getMyDeliveries(session.token);
      setDeliveries(list);

      if (session.user.role === 'RIDER') {
        const available = await getAvailableDeliveries(session.token);
        setAvailableDeliveries(available);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSessionExpired();
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleAcceptDelivery = async (deliveryId: string) => {
    if (!session) return;
    try {
      await acceptDelivery(session.token, deliveryId);
      Alert.alert('Delivery Accepted!', 'You have been assigned to this delivery. Check your deliveries list below.');
      refreshDeliveries();
    } catch (error) {
      Alert.alert('Unable to Accept', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const handleUpdateStatus = async (deliveryId: string, status: DeliveryStatus) => {
    if (!session) return;
    try {
      await updateDeliveryStatus(session.token, deliveryId, status);
      Alert.alert('Status Updated', `Delivery is now ${readable(status)}.`);
      refreshDeliveries();
    } catch (error) {
      Alert.alert('Update Failed', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const handleToggleOnline = async () => {
    if (!session) return;
    const nextState = !isOnline;
    setIsOnline(nextState);
    try {
      await setRiderAvailability(session.token, nextState);
    } catch {}
  };

  // Load deliveries when session becomes available
  useEffect(() => {
    if (session) {
      refreshDeliveries();
    }
  }, [session]);

  // Connect to Real-time Stream
  useEffect(() => {
    if (!session) return;
    setIsLive(true);

    const unsubscribe = subscribeToRealtime(
      session.token,
      event => {
        if (event.type === 'DELIVERY_UPDATE' || event.type === 'NOTIFICATION') {
          // Refresh delivery list in real-time
          refreshDeliveries();
        }
      },
      () => {
        setIsLive(false);
      }
    );

    return () => {
      unsubscribe();
      setIsLive(false);
    };
  }, [session, isOnline]);

  if (loadingSession) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.loading}>
          <ActivityIndicator color={green} size="large" />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        {!session ? (
          <Auth onSession={setSession} />
        ) : screen === 'create' ? (
          <Create
            token={session.token}
            onBack={() => setScreen('home')}
            onSessionExpired={handleSessionExpired}
            onCreated={delivery => {
              setDeliveries(current => [delivery, ...current]);
              setTracking(delivery.trackingCode);
              setScreen('track');
            }}
          />
        ) : screen === 'track' ? (
          <Tracking
            tracking={tracking}
            onSessionExpired={handleSessionExpired}
            onBack={() => {
              setTracking(undefined);
              setScreen('home');
            }}
          />
        ) : (
          <Home
            session={session}
            deliveries={deliveries}
            availableDeliveries={availableDeliveries}
            refreshing={refreshing}
            isLive={isLive}
            isOnline={isOnline}
            onToggleOnline={handleToggleOnline}
            onRefresh={refreshDeliveries}
            onCreate={() => setScreen('create')}
            onTrack={code => {
              setTracking(code);
              setScreen('track');
            }}
            onAcceptDelivery={handleAcceptDelivery}
            onUpdateStatus={handleUpdateStatus}
            onSignOut={async () => {
              await clearSession();
              setSession(null);
              setDeliveries([]);
              setAvailableDeliveries([]);
              setIsLive(false);
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// -------------------------------------------------------------------------
// Styles
// -------------------------------------------------------------------------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F8F2' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8F2' },
  auth: { flexGrow: 1, padding: 25, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center'
  },
  markText: { color: lime, fontSize: 34, fontWeight: '800', marginTop: -5 },
  brandWord: { fontSize: 25, fontWeight: '900', color: green, letterSpacing: -1 },
  authTitle: { fontSize: 34, lineHeight: 40, fontWeight: '900', letterSpacing: -1, color: '#193023', marginTop: 43 },
  muted: { fontSize: 14, lineHeight: 21, color: '#718078', marginTop: 9 },
  form: { gap: 11, marginTop: 27 },
  input: {
    height: 55,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DCE4DA',
    backgroundColor: '#FFF',
    paddingHorizontal: 15,
    fontSize: 14,
    color: '#1C3225'
  },
  button: {
    height: 57,
    borderRadius: 16,
    backgroundColor: green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 17,
    marginTop: 5
  },
  buttonSubtle: { backgroundColor: '#E3F0E3' },
  buttonText: { fontSize: 15, fontWeight: '800', color: '#FFF' },
  buttonTextSubtle: { color: green },
  switch: { color: green, textAlign: 'center', fontSize: 13, fontWeight: '800', marginTop: 12 },
  footnote: { fontSize: 11, lineHeight: 16, color: '#8A958E', textAlign: 'center', marginTop: 34 },
  scroll: { padding: 22, paddingBottom: 45 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: {
    height: 42,
    width: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF'
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E6F4E7',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2E7D32' },
  liveText: { fontSize: 10, fontWeight: '800', color: '#2E7D32' },
  liveSync: { fontSize: 11, fontWeight: '700', color: '#40A369' },
  kicker: { fontSize: 11, letterSpacing: 1.4, fontWeight: '900', color: '#6D7B72', marginTop: 29 },
  title: { fontSize: 30, lineHeight: 37, fontWeight: '900', letterSpacing: -0.9, color: '#172D20', marginTop: 6 },
  map: {
    height: 155,
    borderRadius: 21,
    marginTop: 24,
    backgroundColor: '#DCECDF',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: 15
  },
  pin: {
    position: 'absolute',
    top: 38,
    left: '57%',
    height: 44,
    width: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: orange,
    borderWidth: 4,
    borderColor: '#FFF'
  },
  mapCaption: {
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '800',
    color: green
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 27, marginBottom: 3 },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: '#1B3425' },
  link: { fontSize: 13, fontWeight: '800', color: green },
  deliveryCard: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    padding: 15,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  box: { width: 50, height: 50, borderRadius: 15, backgroundColor: '#E6F4E7', alignItems: 'center', justifyContent: 'center' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tracking: { fontSize: 13, fontWeight: '900', color: '#25402F' },
  price: { fontSize: 13, fontWeight: '900', color: green },
  route: { fontSize: 12, color: '#6C7B72', marginTop: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  statusDot: { height: 7, width: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '800' },
  riderBadge: { fontSize: 11, color: '#6C7B72', marginLeft: 4 },
  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    gap: 12
  },
  riderAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center'
  },
  riderTitle: { fontSize: 11, fontWeight: '800', color: '#2E7D32', textTransform: 'uppercase' },
  riderName: { fontSize: 15, fontWeight: '900', color: '#1B3425', marginTop: 2 },
  riderPhone: { fontSize: 12, color: '#496153', marginTop: 2 },
  empty: { alignItems: 'center', backgroundColor: '#FFF', borderRadius: 18, padding: 28, marginTop: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '900', color: '#253D2D', marginTop: 10 },
  emptyText: { fontSize: 12, color: '#76847B', textAlign: 'center', marginTop: 5 },
  back: { height: 42, width: 42, borderRadius: 21, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, fontWeight: '900', letterSpacing: 1.1, color: '#6F7D74', marginTop: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11, borderWidth: 1, borderColor: '#DCE4DA', backgroundColor: '#FFF' },
  chipOn: { borderColor: green, backgroundColor: green },
  chipText: { fontSize: 12, fontWeight: '800', color: '#496153' },
  chipTextOn: { color: '#FFF' },
  search: { flexDirection: 'row', gap: 9, alignItems: 'center', marginTop: 23 },
  searchButton: { height: 55, width: 55, borderRadius: 15, backgroundColor: green, alignItems: 'center', justifyContent: 'center' },
  timeline: { backgroundColor: '#FFF', borderRadius: 18, padding: 17, marginTop: 16, gap: 15 },
  timelineItem: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  timelineDot: { height: 11, width: 11, borderRadius: 6, borderWidth: 2, borderColor: '#B9C5BD', marginTop: 3 },
  timelineDotOn: { backgroundColor: '#40A369', borderColor: '#40A369' },
  timelineStatus: { fontSize: 13, fontWeight: '800', color: '#29402F' },
  timelineNote: { fontSize: 11, color: '#77857C', marginTop: 2 },
  roleContainer: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 8 },
  roleCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#DCE4DA',
    backgroundColor: '#FFF'
  },
  roleCardActive: { borderColor: green, backgroundColor: green },
  roleTitle: { fontSize: 13, fontWeight: '800', color: '#1B3425' },
  roleTitleActive: { color: '#FFF' },
  roleSubtitle: { fontSize: 10, color: '#718078', marginTop: 1 },
  roleSubtitleActive: { color: '#DCECDF' },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E6F4E7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12
  },
  roleBadgeText: { fontSize: 11, fontWeight: '800', color: green },
  riderStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    padding: 14,
    borderRadius: 16,
    marginTop: 14
  },
  riderStatusText: { fontSize: 12, fontWeight: '800', color: '#253D2D' },
  onlineToggleBtn: {
    backgroundColor: '#2E7D32',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10
  },
  onlineToggleBtnOff: { backgroundColor: '#718078' },
  onlineToggleText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  availableCard: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    borderLeftWidth: 4,
    borderLeftColor: green
  },
  parcelSizeBadge: { fontSize: 11, fontWeight: '800', color: '#55695D' },
  acceptBtn: {
    backgroundColor: green,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10
  },
  acceptBtnText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  riderActionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: {
    flex: 1,
    backgroundColor: green,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionBtnText: { color: '#FFF', fontSize: 12, fontWeight: '800' }
});
