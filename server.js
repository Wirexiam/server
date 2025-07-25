const express = require("express");
const multer  = require("multer");
const fs      = require("fs");
const { google } = require("googleapis");
const path    = require("path");
require("dotenv").config();

const cors = require("cors");


const upload = multer({ dest: "uploads/" });
const app = express();
app.use(cors());

// === Загрузка client_secret.json (или через переменные окружения) ===
let clientSecret, clientId, redirectUri;
try {
  const creds = JSON.parse(fs.readFileSync("client_secret.json"));
  clientId     = creds.web.client_id;
  clientSecret = creds.web.client_secret;
  redirectUri  = process.env.REDIRECT_URI || creds.web.redirect_uris[0];
} catch (e) {
  clientId     = process.env.GOOGLE_CLIENT_ID;
  clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  redirectUri  = process.env.REDIRECT_URI;
}

const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

// === Получение refresh_token: /auth → /oauth2callback ===
app.get("/auth", (req, res) => {
  const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync("token.json", JSON.stringify(tokens));
    res.send(
      "<h2>Авторизация прошла успешно!</h2>Токен сохранён на сервере.<br>Можешь закрыть это окно и пользоваться API."
    );
  } catch (e) {
    res.status(500).send("Ошибка авторизации: " + e.message);
  }
});

// === Файл upload через Google Drive API ===
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    // === 1. Подгружаем токен (refresh_token) ===
    const tokens = JSON.parse(fs.readFileSync("token.json"));
    oAuth2Client.setCredentials(tokens);

    // === 2. Готовим файл и метаданные ===
    const drive = google.drive({ version: "v3", auth: oAuth2Client });
    const fileMetadata = {
      name: req.file.originalname,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID].filter(Boolean),
    };
    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path),
    };
    // === 3. Загружаем файл ===
    const file = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id,webViewLink",
    });

    fs.unlinkSync(req.file.path); // удаляем temp-файл

    res.json({ fileId: file.data.id, link: file.data.webViewLink });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Проверка сервиса
app.get("/", (req, res) =>
  res.send(
    `<h1>Google Drive Upload API</h1>
    <a href="/auth">1. Авторизация с Google (разово!)</a><br>
    <span>2. Используй POST /api/upload для загрузки файлов</span>`
  )
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Server running on port", PORT, "Ready for Google OAuth2 and file upload")
);
