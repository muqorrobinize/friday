export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/') {
      return handleInteraction(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleInteraction(request, env) {
  const { messages, enableSearch = false, enableVoice = false } = await request.json();
  const lastUserPrompt = messages[messages.length - 1].content;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const textEncoder = new TextEncoder();

  const writeData = (data) => writer.write(textEncoder.encode(JSON.stringify(data) + '\n'));

  const simulateAIResponse = async () => {
    try {
      await writeData({ type: 'text', content: `Prompt diterima: "${lastUserPrompt}".` });
      await new Promise((r) => setTimeout(r, 500));

      if (enableSearch) {
        await writeData({ type: 'text', content: '🔍 Saya akan mencari informasi dari internet...' });
        await new Promise((r) => setTimeout(r, 1000));
        await writeData({ type: 'text', content: '📄 Ditemukan artikel relevan: "Contoh hasil pencarian."' });
      } else {
        await writeData({ type: 'text', content: '🤖 Menggunakan pengetahuan internal...' });
      }

      await new Promise((r) => setTimeout(r, 500));
      await writeData({ type: 'text', content: `✍️ Ini adalah respons simulasi untuk "${lastUserPrompt}".` });

      if (enableVoice) {
        const dummyAudio = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='; // base64-encoded empty WAV
        await new Promise((r) => setTimeout(r, 500));
        await writeData({ type: 'audio', content: dummyAudio });
      }
    } catch (e) {
      await writeData({ type: 'text', content: `❌ Terjadi kesalahan: ${e.message}` });
    } finally {
      writer.close();
    }
  };

  simulateAIResponse();

  return new Response(readable, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
