document.addEventListener('DOMContentLoaded', () => {
    // --- Referensi Elemen DOM ---
    const promptInput = document.getElementById('prompt-input');
    const askButton = document.getElementById('ask-button');
    const chatContainer = document.getElementById('chat-container');
    
    // Tombol Kontrol
    const voiceToggle = document.getElementById('voice-toggle');
    const searchToggle = document.getElementById('search-toggle');
    const micButton = document.getElementById('mic-button');
    const callModeButton = document.getElementById('call-mode-button');
    
    // Tampilan Mode
    const chatModeView = document.getElementById('chat-mode-view');
    const callModeView = document.getElementById('call-mode-view');
    const callStatus = document.getElementById('call-status');
    const endCallButton = document.getElementById('end-call-button');

    // --- State Aplikasi ---
    let audioContext;
    const audioQueue = [];
    let isPlaying = false;
    let conversationHistory = []; // Menyimpan memori percakapan
    
    // Untuk Web Speech API (Mikrofon)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'id-ID'; // Set bahasa ke Indonesia
        recognition.interimResults = false;
    } else {
        micButton.style.display = 'none'; // Sembunyikan tombol mic jika tidak didukung
        callModeButton.style.display = 'none';
    }

    // --- Event Listeners ---
    askButton.addEventListener('click', handleAsk);
    promptInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') handleAsk();
    });

    if (recognition) {
        micButton.addEventListener('click', toggleMic);
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            promptInput.value = transcript;
            handleAsk(); // Otomatis kirim setelah transkripsi selesai
        };
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            callStatus.textContent = `Error: ${event.error}`;
        };
        recognition.onstart = () => {
            micButton.classList.add('active');
            callStatus.textContent = 'Mendengarkan...';
        };
        recognition.onend = () => {
            micButton.classList.remove('active');
            callStatus.textContent = 'Memproses...';
        };
    }

    callModeButton.addEventListener('click', enterCallMode);
    endCallButton.addEventListener('click', exitCallMode);


    // --- Fungsi Utama ---

    function addMessageToChat(role, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', role === 'user' ? 'user-message' : 'ai-message');
        messageDiv.textContent = text;
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight; // Auto-scroll
        return messageDiv;
    }

    async function handleAsk() {
        const prompt = promptInput.value.trim();
        if (!prompt || askButton.disabled) return;

        askButton.disabled = true;
        promptInput.value = '';

        // Tampilkan pesan pengguna dan tambahkan ke riwayat
        if (chatModeView.style.display !== 'none') {
            addMessageToChat('user', prompt);
        }
        conversationHistory.push({ role: 'user', content: prompt });

        // Buat gelembung pesan kosong untuk AI jika dalam mode chat
        let aiMessageDiv;
        if (chatModeView.style.display !== 'none') {
            aiMessageDiv = addMessageToChat('assistant', '...');
        }
        
        let fullAiResponse = '';

        try {
            const response = await fetch('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Kirim seluruh riwayat percakapan dan status tombol ke backend
                body: JSON.stringify({ 
                    messages: conversationHistory,
                    enableSearch: searchToggle.checked,
                    enableVoice: voiceToggle.checked
                })
            });

            if (!response.body) throw new Error("Gagal mendapatkan stream.");

            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const jsonChunks = value.split('\n').filter(s => s.trim() !== '');
                
                for (const chunk of jsonChunks) {
                    try {
                        const data = JSON.parse(chunk);
                        if (data.type === 'text') {
                            if (aiMessageDiv && aiMessageDiv.textContent === '...') aiMessageDiv.textContent = '';
                            if (aiMessageDiv) aiMessageDiv.textContent += data.content;
                            fullAiResponse += data.content;
                        } else if (data.type === 'audio') {
                            const audioData = atob(data.content);
                            const audioBytes = new Uint8Array(audioData.length);
                            for (let i = 0; i < audioData.length; i++) {
                                audioBytes[i] = audioData.charCodeAt(i);
                            }
                            audioQueue.push(audioBytes.buffer);
                            if (!isPlaying) playQueue();
                        }
                    } catch (e) {
                        console.error("Gagal mem-parsing JSON chunk:", chunk, e);
                    }
                }
            }
        } catch (error) {
            console.error('Error:', error);
            if (aiMessageDiv) aiMessageDiv.textContent = `Error: ${error.message}`;
        } finally {
            conversationHistory.push({ role: 'assistant', content: fullAiResponse });
            askButton.disabled = false;
            promptInput.focus();
        }
    }

    // --- Fungsi Audio & Mikrofon ---

    async function playQueue() {
        if (audioQueue.length === 0) {
            isPlaying = false;
            // Jika dalam mode panggilan, otomatis dengarkan lagi setelah AI selesai bicara
            if (callModeView.style.display !== 'none') {
                toggleMic();
            }
            return;
        }
        isPlaying = true;
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        const buffer = audioQueue.shift();
        const audioBuffer = await audioContext.decodeAudioData(buffer);
        
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.onended = playQueue;
        source.start();
    }

    function toggleMic() {
        if (micButton.classList.contains('active')) {
            recognition.stop();
        } else {
            recognition.start();
        }
    }

    // --- Fungsi Mode Panggilan ---

    function enterCallMode() {
        chatModeView.style.display = 'none';
        callModeView.style.display = 'flex';
        voiceToggle.checked = true; // Paksa suara aktif dalam mode panggilan
        toggleMic(); // Langsung mulai mendengarkan
    }

    function exitCallMode() {
        if (micButton.classList.contains('active')) {
            recognition.stop();
        }
        chatModeView.style.display = 'flex';
        callModeView.style.display = 'none';
    }
});