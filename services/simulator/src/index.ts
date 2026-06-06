import pg from "pg";
import pino from "pino";

const logger = pino({ base: { service: "simulator" }, timestamp: pino.stdTimeFunctions.isoTime });
const databaseUrl = process.env.DATABASE_URL ?? "postgres://fraudpulse:fraudpulse@localhost:5432/fraudpulse";
const apiUrl = process.env.API_URL ?? "http://localhost:4000";
const apiServiceToken = process.env.API_SERVICE_TOKEN ?? "local-service-token";
const tps = Math.max(0.2, Number(process.env.SIMULATOR_TPS ?? 3));
const pool = new pg.Pool({ connectionString: databaseUrl });

interface DemoUser {
  user_id: string;
  card_id: string;
  home_latitude: string;
  home_longitude: string;
  baseline_daily_amount: string;
}

interface DemoMerchant {
  id: string;
  latitude: string;
  longitude: string;
  risk_score: number;
  category: string;
}

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const normalAmount = (baseline: number) => Math.max(2, random(0.05, 0.55) * baseline);
const fraudAmount = (baseline: number) => random(2.5, 7) * baseline;
const jitter = (value: number, spread = 0.08) => value + random(-spread, spread);

const loadDemo = async () => {
  const users = await pool.query<DemoUser>(
    `SELECT u.id AS user_id, c.id AS card_id, u.home_latitude, u.home_longitude, u.baseline_daily_amount
     FROM users u JOIN cards c ON c.user_id = u.id`
  );
  const merchants = await pool.query<DemoMerchant>("SELECT id, latitude, longitude, risk_score, category FROM merchants");
  return { users: users.rows, merchants: merchants.rows };
};

const createTransaction = async (users: DemoUser[], merchants: DemoMerchant[]) => {
  const user = pick(users);
  const fraudMode = Math.random() < 0.14;
  const highRiskMerchants = merchants.filter(merchant => merchant.risk_score >= 65);
  const merchant = fraudMode && highRiskMerchants.length ? pick(highRiskMerchants) : pick(merchants);
  const baseline = Number(user.baseline_daily_amount);
  const amount = Number((fraudMode ? fraudAmount(baseline) : normalAmount(baseline)).toFixed(2));
  const useMerchantGeo = fraudMode || Math.random() < 0.35;
  const latitude = useMerchantGeo ? Number(merchant.latitude) : jitter(Number(user.home_latitude));
  const longitude = useMerchantGeo ? Number(merchant.longitude) : jitter(Number(user.home_longitude));
  const body = {
    userId: user.user_id,
    cardId: user.card_id,
    merchantId: merchant.id,
    amount,
    currency: "USD",
    latitude,
    longitude,
    channel: merchant.category === "atm" ? "atm" : Math.random() < 0.55 ? "ecommerce" : "pos",
    deviceFingerprint: fraudMode && Math.random() < 0.7 ? `device-risk-${Math.floor(random(1000, 9999))}` : `device-${user.user_id.slice(0, 8)}`,
    ipAddress: fraudMode ? `45.${Math.floor(random(10, 240))}.${Math.floor(random(10, 240))}.${Math.floor(random(10, 240))}` : "73.44.21.10",
    isFraudGroundTruth: fraudMode
  };

  const response = await fetch(`${apiUrl}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-token": apiServiceToken },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`api_rejected_transaction:${response.status}`);
  logger.info({ amount, fraudMode, merchantRisk: merchant.risk_score }, "transaction_generated");
};

const isRunning = async () => {
  try {
    const response = await fetch(`${apiUrl}/simulator/state`, { headers: { "x-api-token": apiServiceToken } });
    if (!response.ok) return true;
    const state = await response.json() as { running?: boolean };
    return state.running !== false;
  } catch {
    return true;
  }
};

const main = async () => {
  let demo = await loadDemo();
  if (!demo.users.length || !demo.merchants.length) {
    throw new Error("demo_seed_data_missing");
  }
  setInterval(async () => {
    try {
      if (!(await isRunning())) return;
      if (Math.random() < 0.02) demo = await loadDemo();
      await createTransaction(demo.users, demo.merchants);
    } catch (err) {
      logger.warn({ err }, "simulator_tick_failed");
    }
  }, Math.round(1000 / tps));
};

main().catch(error => {
  logger.error({ error }, "simulator_failed");
  process.exit(1);
});
