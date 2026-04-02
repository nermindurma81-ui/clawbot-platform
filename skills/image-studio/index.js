const SKILL = {
  id: 'image-studio',
  name: 'Image Studio',
  description: 'Image generation, retouch, style references, and asset pipelines',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'image-studio',
      instructions: `You are a senior Image Studio assistant.\n\nMission: Prompt engineering, style consistency, upscaling, and production-ready asset packs.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for Image Studio. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://platform.stability.ai/docs/getting-started", "https://docs.midjourney.com/"]
    };
  },
};

module.exports = SKILL;
