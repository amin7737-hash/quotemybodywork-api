const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sessionId } = req.body;
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return res.status(400).json({ error: "Payment not completed" });

    const { leadId, shopId } = session.metadata;
    const leadRef = db.collection("leads").doc(leadId);
    const leadDoc = await leadRef.get();
    if (!leadDoc.exists) return res.status(404).json({ error: "Lead not found" });
    const lead = leadDoc.data();
    if (lead.buyers?.includes(shopId)) return res.json({ success: true });

    const newBuyers = [...(lead.buyers || []), shopId];
    await leadRef.update({
      buyers: newBuyers,
      status: newBuyers.length >= lead.maxBuyers ? "closed" : lead.status,
    });
    await db.collection("purchases").add({
      leadId, shopId,
      price: session.amount_total / 100,
      sessionId,
      purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
