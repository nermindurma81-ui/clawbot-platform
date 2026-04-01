const SKILL = {
  id: 'translator',
  name: 'Translator',
  description: 'Translate text between languages',

  // Free LibreTranslate instances (no API key needed)
  endpoints: [
    'https://translate.terraprint.co/translate',
    'https://trans.zillyhuhn.com/translate',
  ],

  async run(params) {
    const { text, from = 'auto', to = 'en' } = params;

    if (!text) return { error: 'No text provided' };

    // Try each endpoint
    for (const url of this.endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q: text,
            source: from,
            target: to,
            format: 'text',
          }),
          signal: AbortSignal.timeout(10000),
        });

        const data = await res.json();
        if (data.translatedText) {
          return {
            success: true,
            original: text,
            translated: data.translatedText,
            from: from === 'auto' ? 'auto-detected' : from,
            to,
            provider: 'LibreTranslate',
          };
        }
      } catch (err) {
        continue; // try next endpoint
      }
    }

    // Fallback: use LLM translation
    return {
      success: false,
      fallback: true,
      instructions: `Translate the following text from ${from === 'auto' ? 'auto-detected language' : from} to ${to}. Return ONLY the translation, nothing else.`,
      context: text,
    };
  },
};

module.exports = SKILL;
