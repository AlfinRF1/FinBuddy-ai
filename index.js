const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


app.post('/api/catat', async (req, res) => {
    try {
        const teksUser = req.body.pesan;

        if (!teksUser) {
            return res.status(400).json({ error: "Pesan tidak boleh kosong ya bre!" });
        }

        // Kita pakai gemini-pro yang stabil
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
        Kamu adalah FinBuddy, asisten keuangan pribadi yang santai, suportif, dan menggunakan bahasa gaul (lu/gw, bro/sist).
        Tugasmu mengekstrak data dari transaksi user ke dalam format JSON.
        
        Kalimat user: "${teksUser}"
        
        WAJIB balas HANYA dengan format JSON murni persis seperti di bawah ini. Jangan tambahkan penjelasan, jangan gunakan backtick markdown.
        {
          "jenis_transaksi": "Pilih satu: Pemasukan atau Pengeluaran",
          "kategori": "Pilih kategori yang sesuai (contoh: Makanan, Transportasi, Gaji, Bisnis, Tagihan, Lainnya)",
          "nominal": angka bulat (contoh: 20000),
          "pesan_finbuddy": "Berikan 1 kalimat komentar santai soal transaksi ini"
        }
        `;

        const result = await model.generateContent(prompt);
        const responsAI = result.response.text();
        
        // 1. KITA PRINT DULU BALASAN ASLINYA KE TERMINAL VS CODE
        console.log("=== BALASAN DARI AI ===");
        console.log(responsAI);
        console.log("=======================");

        // 2. KITA BERSIHKAN MARKDOWN (Biar nggak error)
        let teksBersih = responsAI.replace(/```json/gi, '').replace(/```/gi, '').trim();
        
        // 3. KITA UBAH JADI DATA JSON
        const dataBersih = JSON.parse(teksBersih);

        res.json({
            status: "sukses",
            data: dataBersih
        });

    } catch (error) {
        // ERROR-NYA KITA KIRIM KE POSTMAN BIAR LU BISA BACA
        console.error(error);
        res.status(500).json({ 
            error: "Waduh, servernya error bre.",
            penyebab_asli: error.message // <--- Ini kunci buat nemuin masalahnya
        });
    }
});

app.listen(port, () => {
    console.log(`Server udah jalan mantap di http://localhost:${port}`);
});