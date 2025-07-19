import { Ai } from '@cloudflare/ai';

export async function onRequest(context) {
    const { request, env } = context;
    // Ambil data dari request frontend, termasuk riwayat pesan dan status tombol
    const { messages, enableSearch, enableVoice } = await request.json();
    const ai = new Ai(env.AI);

    // Ambil prompt terakhir dari pengguna untuk digunakan dalam pencarian internet
    const lastUserPrompt = messages[messages.length - 1].content;

    // --- BAGIAN PENCARIAN INTERNET (KONDISIONAL) ---
    let contextMessage = "No search results found.";
    if (enableSearch) {
        try {
            // Buat parameter untuk URL pencarian SerpApi
            const params = new URLSearchParams({
                q: lastUserPrompt,
                api_key: env.SERPAPI_API_KEY, // Mengambil API key dari secret
                engine: 'google',
                gl: 'id', // Negara: Indonesia
                hl: 'id'  // Bahasa: Indonesia
            });
            
            // Panggil SerpApi untuk mendapatkan konteks dari internet
            const searchResponse = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
            const searchResults = await searchResponse.json();
            
            // Ambil 3 hasil pencarian teratas untuk dijadikan konteks
            if (searchResults.organic_results && searchResults.organic_results.length > 0) {
                contextMessage = searchResults.organic_results.slice(0, 3).map(r => `Title: ${r.title}, Snippet: ${r.snippet}`).join('\n\n');
            }
        } catch (e) {
            console.error("SerpApi call failed:", e);
            contextMessage = "Failed to fetch search results.";
        }
    }
    // --- AKHIR BAGIAN PENCARIAN INTERNET ---

    // Buat prompt sistem untuk AI, berikan kepribadian dan hasil pencarian (jika ada)
    const system_prompt = `Your name is Friday. You are a helpful and friendly AI assistant.
    Use the following search results to provide a comprehensive and up-to-date answer in Indonesian.
    If search was not enabled or results are not relevant, ignore them and answer based on your existing knowledge.
    Keep your answers concise.

    Search Results:
    ${contextMessage}`;
    
    // Gabungkan riwayat percakapan dengan prompt sistem
    const messagesWithSystemPrompt = [
        { role: 'system', content: system_prompt },
        ...messages
    ];

    // Buat stream yang bisa kita kontrol untuk mengirim data ke frontend
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const textEncoder = new TextEncoder();

    // Fungsi untuk mengirim data JSON melalui stream
    const writeData = (data) => {
        return writer.write(textEncoder.encode(JSON.stringify(data) + '\n'));
    };

    // Panggil model bahasa (LLM) untuk menghasilkan jawaban teks secara streaming
    const llmStream = await ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: messagesWithSystemPrompt,
        stream: true
    });

    // --- LOGIKA STREAMING GANDA (TEKS & AUDIO) ---
    if (enableVoice) {
        // Jika suara aktif, kita perlu memproses teks dan audio secara bersamaan.
        // Kita gandakan stream dari LLM agar bisa dibaca oleh dua proses.
        const [llmStreamForText, llmStreamForTTS] = llmStream.tee();

        // Proses 1: Mengirim teks ke frontend
        const textPromise = (async () => {
            const reader = llmStreamForText.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const decodedText = new TextDecoder().decode(value);
                await writeData({ type: 'text', content: decodedText });
            }
        })();

        // Proses 2: Mengirim teks ke model TTS dan mengirim hasilnya (audio) ke frontend
        const audioPromise = (async () => {
            const ttsStream = await ai.run('@cf/elevenlabs/speech-synthesis-with-speechmarks', {
                text: llmStreamForTTS,
                voice_id: 'Rachel'
            });
            const reader = ttsStream.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // Encode audio chunk ke base64 sebelum dikirim
                const base64Audio = btoa(String.fromCharCode.apply(null, value));
                await writeData({ type: 'audio', content: base64Audio });
            }
        })();

        // Tunggu kedua proses selesai, lalu tutup stream
        Promise.all([textPromise, audioPromise]).finally(() => writer.close());

    } else {
        // Jika suara tidak aktif, kita hanya perlu mengirim stream teks
        const processTextOnly = async () => {
            const reader = llmStream.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const decodedText = new TextDecoder().decode(value);
                await writeData({ type: 'text', content: decodedText });
            }
            writer.close();
        };
        processTextOnly();
    }

    // Kembalikan stream yang bisa dibaca oleh frontend
    return new Response(readable, {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}
