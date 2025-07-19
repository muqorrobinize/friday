export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/') {
      return handleSimpleTest(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};

// Fungsi tes yang sangat sederhana
async function handleSimpleTest(request, env) {
  const { messages } = await request.json();
  const lastUserPrompt = messages[messages.length - 1].content;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const textEncoder = new TextEncoder();

  const writeData = (data) => {
    return writer.write(textEncoder.encode(JSON.stringify(data) + '\n'));
  };

  // Jangan panggil AI, langsung kirim respons palsu
  const processTest = async () => {
    try {
      // Kirim pesan "User berkata: ..."
      await writeData({ type: 'text', content: `Anda mengirim: "${lastUserPrompt}". ` });
      await new Promise(resolve => setTimeout(resolve, 500)); // Jeda 0.5 detik

      // Kirim pesan "Saya akan merespons..."
      await writeData({ type: 'text', content: `Saya akan membalas... ` });
      await new Promise(resolve => setTimeout(resolve, 500)); // Jeda 0.5 detik

      // Kirim kata "PONG" satu per satu
      for (const char of "PONG!") {
        await writeData({ type: 'text', content: char });
        await new Promise(resolve => setTimeout(resolve, 200)); // Jeda 0.2 detik
      }
    } catch (e) {
      console.error("Error in simple test:", e);
    } finally {
      writer.close();
    }
  };

  processTest();

  return new Response(readable, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}