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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { leadId, shopId, amount, leadName, returnUrl } = req.body;
    if (!leadId || !shopId || !amount) return res.status(400).json({ error: "Missing required fields" });

    const leadDoc = await db.collection("leads").doc(leadId).get();
    if (!leadDoc.exists) return res.status(404).json({ error: "Lead not found" });
    const lead = leadDoc.data();
    if (lead.buyers?.includes(shopId)) return res.status(400).json({ error: "Already purchased" });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "gbp",
          product_data: { name: `Lead: ${leadName || "Vehicle Bodywork Job"}` },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${returnUrl}?success=true&leadId=${leadId}&shopId=${shopId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?cancelled=true`,
      metadata: { leadId, shopId },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
