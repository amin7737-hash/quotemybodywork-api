const admin = require("firebase-admin");
const { google } = require("googleapis");

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

function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Get all connected sheets from settings
    const settingsDoc = await db.collection("settings").doc("global").get();
    const settings = settingsDoc.data() || {};
    const sheets = settings.googleSheets || [];

    if (sheets.length === 0) return res.json({ message: "No sheets connected", synced: 0 });

    // Set up Google Sheets API
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheetsApi = google.sheets({ version: "v4", auth });
    let totalSynced = 0;

    for (const sheet of sheets) {
      const sheetId = extractSheetId(sheet.url);
      if (!sheetId) continue;

      try {
        // Get all rows from the sheet
        const response = await sheetsApi.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: "A:Z",
        });

        const rows = response.data.values || [];
        if (rows.length < 2) continue; // No data rows

        const headers = rows[0].map(h => h.toLowerCase().trim());

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const rowData = {};
          headers.forEach((h, idx) => { rowData[h] = row[idx] || ""; });

          // Create a unique ID for this row to avoid duplicates
          const rowId = `sheet_${sheetId}_row_${i}`;

          // Check if already imported
          const existing = await db.collection("leads").where("sheetRowId", "==", rowId).get();
          if (!existing.empty) continue;

          // Map common Facebook Lead Ad field names
          const name = rowData["full name"] || rowData["name"] || rowData["first name"] + " " + rowData["last name"] || "";
          const phone = rowData["phone number"] || rowData["phone"] || rowData["mobile"] || "";
          const email = rowData["email"] || rowData["email address"] || "";
          const vehicle = rowData["car make and model"] || rowData["vehicle"] || rowData["car"] || "";
          const damage = rowData["damage description"] || rowData["damage"] || rowData["description"] || "";
          const area = rowData["postcode"] || rowData["location"] || rowData["area"] || rowData["city"] || sheet.name || "UK";

          // Create the Bronze lead
          await db.collection("leads").add({
            name: name.trim(),
            phone: phone.trim(),
            whatsapp: phone.trim(),
            email: email.trim(),
            vehicle: vehicle.trim() || "Not specified",
            damage: damage.trim() || "See lead for details",
            area: area.trim(),
            workType: rowData["work type"] || rowData["type of work"] || "Bodywork & Paint",
            budget: rowData["budget"] || "Not specified",
            timeline: rowData["timeline"] || "Not specified",
            callTime: rowData["best time to call"] || rowData["call time"] || "Anytime",
            tier: "bronze",
            source: `Facebook Ads — ${sheet.name}`,
            sheetRowId: rowId,
            sheetName: sheet.name,
            buyers: [],
            status: "new",
            photoUrls: [],
            photoCount: 0,
            maxBuyers: settings.maxBuyers || 3,
            price: settings.bronzePrice || settings.defaultPrice || 8,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          totalSynced++;
        }
      } catch (sheetErr) {
        console.error(`Error syncing sheet ${sheet.name}:`, sheetErr.message);
      }
    }

    res.json({ success: true, synced: totalSynced, message: `Synced ${totalSynced} new Bronze leads` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
