import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

dotenv.config();

const app = express();
const port = 3000;

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

app.use(express.json());
app.use(express.static('public'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: {
        temperature: 0.7, 
        topK: 40,        
        topP: 0.95,      
        maxOutputTokens: 1000, 
    }
});

const bersihinJSON = (text) => {
    return text.replace(/```json|```/gi, '').trim();
};

const detectKategori = (text) => {
    text = text.toLowerCase();
    const rules = {
        Makanan: ['makan', 'kopi', 'minum', 'nasi', 'ayam', 'cafe'],
        Transportasi: ['bensin', 'gojek', 'grab', 'ojek', 'tol'],
        Gaji: ['gaji', 'salary', 'upah', 'bonus'],
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
    if (/(gaji|masuk|dapat|income|bonus)/.test(text)) return 'Pemasukan';
    return 'Pengeluaran';
};

const extractNominal = (text) => {
    const match = text.replace(/\./g, '').match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
};

app.post('/api/chat', upload.single('foto'), async (req, res) => {
    let file = req.file;

    try {
        const teksUser = req.body.pesan || "";

        if (!teksUser && !file) {
            return res.status(400).json({
                status: "error",
                message: "Isi pesan atau upload dulu bro"
            });
        }

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
                    `Analisis gambar ini. Jika ini adalah struk / bukti transaksi, ekstrak total harganya. Jika bukan, tulis "bukan_transaksi".`,
                    imageData
                ]);
                extractedText += " " + result.response.text();
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
                    return res.status(400).json({ status: "error", message: "Audio gagal dibaca bro 😢" });
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

        if (extractedText.includes("bukan_transaksi")) {
             return res.json({ status: "error", message: "Ini bukan struk / transaksi bro 😅" });
        }

        const prompt = `
        Kamu FinBuddy AI. Tugasmu mengekstrak teks ini menjadi JSON keuangan.
        
        WAJIB JSON MURNI:
        {
        "jenis_transaksi": "Pilih: Pemasukan atau Pengeluaran",
        "kategori": "Pilih: Makanan, Transportasi, Gaji, Bisnis, Tagihan, atau Lainnya",
        "nominal": angka bulat (tanpa titik/koma),
        "pesan_finbuddy": "1 kalimat santai dan gaul mengomentari transaksi ini"
        }

        Input:
        "${extractedText}"
        `;

        const resultFinal = await model.generateContent(prompt);
        const textFinal = bersihinJSON(resultFinal.response.text());
        console.log("🧾 TEXT AI:", textFinal);

        let data;
        try {
            data = JSON.parse(textFinal);
        } catch (err) {
            console.log("AI ERROR → fallback jalan");
            data = {
                jenis_transaksi: detectJenis(extractedText),
                kategori: detectKategori(extractedText),
                nominal: extractNominal(extractedText),
                pesan_finbuddy: "Datanya agak aneh bro, tapi gua coba catat 😎"
            };
        }

        res.json({ status: "sukses", data });

    } catch (error) {
        console.error("🔥 ERROR:", error);
        
        if (error.message.includes('503') || error.message.includes('429')) {
             return res.status(503).json({ status: "error", message: "Server AI lagi sibuk bre, coba bentar lagi ya." });
        }

        res.status(500).json({ status: "error", message: "Server error bro", detail: error.message });

    } finally {
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
});

app.listen(port, () => {
    console.log(`🚀 Server jalan di http://localhost:${port}`);
});