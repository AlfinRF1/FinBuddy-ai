const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = 3000;

const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

app.use(express.json());
app.use(express.static('public'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const bersihinJSON = (text) => {
    return text.replace(/```json|```/gi, '').trim();
};

const detectKategori = (text) => {
    text = text.toLowerCase();

    const rules = {
        Makanan: ['makan', 'kopi', 'minum', 'nasi', 'ayam', 'cafe'],
        Transportasi: ['bensin', 'gojek', 'grab', 'ojek', 'tol'],
        Gaji: ['gaji', 'salary', 'upah'],
        Tagihan: ['listrik', 'air', 'wifi', 'internet', 'pln'],
        Bisnis: ['jual', 'order', 'customer', 'profit'],
    };

    for (const kategori in rules) {
        if (rules[kategori].some(k => text.includes(k))) return kategori;
    }

    return 'Lainnya';
};

const detectJenis = (text) => {
    text = text.toLowerCase();
    if (/(gaji|masuk|dapat|income)/.test(text)) return 'Pemasukan';
    return 'Pengeluaran';
};

const extractNominal = (text) => {
    const match = text.replace(/\./g, '').match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
};

app.post('/api/catat', upload.single('foto'), async (req, res) => {
    let file = req.file;

    try {
        const teksUser = req.body.pesan || "";

        if (!teksUser && !file) {
            return res.status(400).json({
                status: "error",
                message: "Isi pesan atau upload dulu bro"
            });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        let extractedText = teksUser;

        if (file) {
            const mime = file.mimetype;
            console.log("📁 MIME:", mime);

            if (mime.startsWith('image/')) {
                const imageData = {
                    inlineData: {
                        data: fs.readFileSync(file.path).toString("base64"),
                        mimeType: mime,
                    },
                };

                const result = await model.generateContent([
`Analisis gambar ini.

Jika ini adalah struk / transaksi:
→ ekstrak ke JSON

Jika BUKAN transaksi:
→ jawab:
{
"error": "bukan_transaksi"
}

Format WAJIB JSON.`,
                    imageData
                ]);

                let text = bersihinJSON(result.response.text());
                console.log("🧾 RAW AI:", text);

                let data;

                try {
                    data = JSON.parse(text);

                    if (data.error === "bukan_transaksi") {
                        return res.json({
                            status: "error",
                            message: "Ini bukan struk / transaksi bro 😅"
                        });
                    }

                } catch (err) {
                    console.log("❌ PARSE ERROR:", err);

                    data = {
                        jenis_transaksi: detectJenis(text),
                        kategori: detectKategori(text),
                        nominal: extractNominal(text),
                        pesan_finbuddy: "Gambar agak aneh bro, tapi gua coba catat 😎"
                    };
                }

                return res.json({
                    status: "sukses",
                    data
                });
            }

            else if (mime.startsWith('audio/')) {
                const audioData = {
                    inlineData: {
                        data: fs.readFileSync(file.path).toString("base64"),
                        mimeType: mime,
                    },
                };

                const result = await model.generateContent([
                    "Transkripsikan audio ini ke teks Bahasa Indonesia.",
                    audioData
                ]);

                const transcript = result.response.text();

                if (!transcript) {
                    return res.status(400).json({
                        status: "error",
                        message: "Audio gagal dibaca bro 😢"
                    });
                }

                console.log("🎧 AUDIO:", transcript);
                extractedText += " " + transcript;
            }

            else if (mime === 'application/pdf') {
                const buffer = fs.readFileSync(file.path);
                const pdfData = await pdfParse(buffer);
                extractedText += " " + pdfData.text;
            }

            else if (mime.includes('wordprocessingml')) {
                const resultDoc = await mammoth.extractRawText({ path: file.path });
                extractedText += " " + resultDoc.value;
            }

            else if (mime === 'text/plain') {
                extractedText += " " + fs.readFileSync(file.path, 'utf-8');
            }
        }

        console.log("🧠 FINAL TEXT:", extractedText);


        const prompt = `
Kamu FinBuddy AI.

WAJIB JSON:
{
"jenis_transaksi": "Pemasukan atau Pengeluaran",
"kategori": "Makanan/Transportasi/Gaji/Bisnis/Tagihan/Lainnya",
"nominal": angka,
"pesan_finbuddy": "1 kalimat santai"
}

Input:
"${extractedText}"
`;

        const result = await model.generateContent(prompt);
        const text = bersihinJSON(result.response.text());

        console.log("🧾 TEXT AI:", text);

        let data;

        try {
            data = JSON.parse(text);
        } catch (err) {
            console.log("AI ERROR → fallback jalan");

            data = {
                jenis_transaksi: detectJenis(extractedText),
                kategori: detectKategori(extractedText),
                nominal: extractNominal(extractedText),
                pesan_finbuddy: "Dicatat manual ya bro 😎"
            };
        }

        data.nominal = parseInt(data.nominal) || extractNominal(extractedText) || 0;
        data.kategori = data.kategori || detectKategori(extractedText);
        data.jenis_transaksi = data.jenis_transaksi || detectJenis(extractedText);

        res.json({
            status: "sukses",
            data
        });

    } catch (error) {
        console.error("🔥 ERROR:", error);

        res.status(500).json({
            status: "error",
            message: "Server error bro",
            detail: error.message
        });

    } finally {
        if (file && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
});

app.listen(port, () => {
    console.log(`🚀 Server jalan di http://localhost:${port}`);
});