// TIDAK LAGI MENGIMPOR Ai DARI @cloudflare/ai
// import { Ai } from '@cloudflare/ai';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/') {
      return handleApiRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};

// Fungsi pembantu untuk memanggil API Cloudflare AI
async function runAi(env, model, inputs) {
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(inputs)
  });
  
  // Jika model text-to-speech, kembalikan stream langsung
  if (model.includes('speech-synthesis')) {
      return response.body;
  }
  
  // Jika model teks, kembalikan stream
  return response.body;
}


async function handleApiRequest(request, env) {
    const { messages, enableSearch, enableVoice } = await request.json();
    // const ai = new Ai(env.AI); // TIDAK DIGUNAKAN LAGI

    const lastUserPrompt = messages[messages.length - 1].content;

    // --- BAGIAN PENCARIAN INTERNET (Tidak ada perubahan) ---
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
    
    // --- PERUBAHAN UTAMA: CARA MEMANGGIL AI ---
    const llmStream = await runAi(env, '@cf/meta/llama-3-8b-instruct', {
        messages: messagesWithSystemPrompt,
        stream: true
    });

    if (enableVoice) {
        const [llmStreamForText, llmStreamForTTS] = llmStream.tee();

        const textPromise = (async () => {
            const reader = llmStreamForText.getReader();
            const textDecoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // Respons dari API HTTP sedikit berbeda, perlu di-decode
                const decodedChunk = textDecoder.decode(value, { stream: true });
                const jsonLines = decodedChunk.split('\n');
                for (const line of jsonLines) {
                    if (line.startsWith('data: ')) {
                        const jsonString = line.substring(6);
                        if (jsonString.trim() === '[DONE]') continue;
                        try {
                           const parsed = JSON.parse(jsonString);
                           await writeData({ type: 'text', content: parsed.response });
                        } catch (e) {}
                    }
                }
            }
        })();

        const audioPromise = (async () => {
            const ttsStream = await runAi(env, '@cf/elevenlabs/speech-synthesis-with-speechmarks', {
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
            const textDecoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // Respons dari API HTTP sedikit berbeda, perlu di-decode
                const decodedChunk = textDecoder.decode(value, { stream: true });
                const jsonLines = decodedChunk.split('\n');
                for (const line of jsonLines) {
                     if (line.startsWith('data: ')) {
                        const jsonString = line.substring(6);
                        if (jsonString.trim() === '[DONE]') continue;
                        try {
                           const parsed = JSON.parse(jsonString);
                           await writeData({ type: 'text', content: parsed.response });
                        } catch (e) {}
                    }
                }
            }
            writer.close();
        };
        processTextOnly();
    }

    return new Response(readable, {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}