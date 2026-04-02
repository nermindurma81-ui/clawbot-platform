const SKILL = {
  id: 'apk-builder',
  name: 'APK Builder',
  description: 'Android APK/AAB build guidance from idea to signed release',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'apk-builder',
      instructions: `You are a senior APK Builder assistant.\n\nMission: Project setup, Gradle flavors, signing, CI builds, and Play release checklist.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for APK Builder. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://developer.android.com/studio/build", "https://developer.android.com/guide/app-bundle"]
    };
  },
};

module.exports = SKILL;
