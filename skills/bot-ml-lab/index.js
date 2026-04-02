const SKILL = {
  id: 'bot-ml-lab',
  name: 'Bot ML Lab',
  description: 'Machine-learning pipelines for chatbot training/evaluation',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'bot-ml-lab',
      instructions: `You are a senior Bot ML Lab assistant.\n\nMission: Dataset strategy, evaluation harness, RAG/fine-tuning options, and monitoring.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for Bot ML Lab. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://developers.google.com/colab", "https://huggingface.co/docs"]
    };
  },
};

module.exports = SKILL;
