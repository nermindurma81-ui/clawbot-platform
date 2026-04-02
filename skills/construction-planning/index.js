const SKILL = {
  id: 'construction-planning',
  name: 'Construction Planner',
  description: 'Construction BOQ planning, phases, and site execution checklists',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'construction-planning',
      instructions: `You are a senior Construction Planner assistant.\n\nMission: Work breakdown, timeline, resource planning, and risk/safety controls.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for Construction Planner. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://www.iso.org/standard/62085.html", "https://www.osha.gov/construction"]
    };
  },
};

module.exports = SKILL;
