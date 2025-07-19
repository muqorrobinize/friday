import { Ai } from '@cloudflare/ai';

// Ini adalah handler utama yang akan dijalankan oleh Cloudflare
export default {
  async fetch(request, env, ctx) {
    // Dapatkan URL dari permintaan untuk memeriksa path-nya
    const url = new URL(request.url);

    // ROUTER: Jika ini adalah permintaan POST ke halaman utama,
    // maka ini adalah panggilan API kita.
    if (request.method === 'POST' && url.pathname === '/') {
      return handleApiRequest(request, env);
    }

    // Jika bukan, maka ini adalah permintaan untuk aset statis
    // (seperti index.html, client.js, atau file CSS).
    // Biarkan platform Cloudflare yang menanganinya.
    return env.ASSETS.fetch(request);
  }
};

// SEMUA KODE LAMA ANDA SEKARANG ADA DI DALAM FUNGSI INI
async function handleApiRequest(request, env) {
    const { messages, enableSearch, enableVoice } = await request.json();
    const ai = new Ai(env.AI);

    const lastUserPrompt = messages[messages.length - 1].content;

    // --- BAGIAN PENCARIAN INTERNET (KONDISIONAL) ---
    let contextMessage = "No search results found.";
    if (enableSearch && env.SERPAPI_API_KEY) {
        try {
            const params = new URLSearchParams({
                q: lastUserPrompt,
                api_key: env.SERPAPI_API_KEY,
                engine: 'google',
                gl: 'id',
                hl: 'id'
            });
            
            const searchResponse = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
            const searchResults = await searchResponse.json();
            
            if (searchResults.organic_results && searchResults.organic_results.length > 0) {
                contextMessage = searchResults.organic_results.slice(0, 3).map(r => `Title: ${r.title}, Snippet: ${r.snippet}`).join('\n\n');
            }
        } catch (e) {
            console.error("SerpApi call failed:", e);
            contextMessage = "Failed to fetch search results.";
        }
    }
    // --- AKHIR BAGIAN PENCARIAN INTERNET ---

    const system_prompt = `Your name is Friday. You are a helpful and friendly AI assistant.
    Use the following search results to provide a comprehensive and up-to-date answer in Indonesian.
    If search was not enabled or results are not relevant, ignore them and answer based on your existing knowledge.
    Keep your answers concise.

    Search Results:
    ${contextMessage}`;
    
    const messagesWithSystemPrompt = [
        { role: 'system', content: system_prompt },
        ...messages
    ];

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const textEncoder = new TextEncoder();

    const writeData = (data) => {
        return writer.write(textEncoder.encode(JSON.stringify(data) + '\n'));
    };

    const llmStream = await ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: messagesWithSystemPrompt,
        stream: true
    });

    if (enableVoice) {
        const [llmStreamForText, llmStreamForTTS] = llmStream.tee();

        const textPromise = (async () => {
            const reader = llmStreamForText.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const decodedText = new TextDecoder().decode(value);
                await writeData({ type: 'text', content: decodedText });
            }
        })();

        const audioPromise = (async () => {
            const ttsStream = await ai.run('@cf/elevenlabs/speech-synthesis-with-speechmarks', {
                text: llmStreamForTTS,
                voice_id: 'Rachel'
            });
            const reader = ttsStream.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const base64Audio = btoa(String.fromCharCode.apply(null, value));
                await writeData({ type: 'audio', content: base64Audio });
            }
        })();

        Promise.all([textPromise, audioPromise]).finally(() => writer.close());

    } else {
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

    return new Response(readable, {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}