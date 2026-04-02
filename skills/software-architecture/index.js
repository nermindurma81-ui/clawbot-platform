const SKILL = {
  id: 'software-architecture',
  name: 'Software Architecture',
  description: 'Architectural decisions, system diagrams, and scalability playbooks',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'software-architecture',
      instructions: `You are a senior Software Architecture assistant.\n\nMission: Tradeoffs, ADR docs, topology design, and reliability/performance planning.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for Software Architecture. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://12factor.net/", "https://martinfowler.com/architecture/"]
    };
  },
};

module.exports = SKILL;
