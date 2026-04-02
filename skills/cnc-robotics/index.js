const SKILL = {
  id: 'cnc-robotics',
  name: 'CNC & Robotics Engineer',
  description: 'CNC workflow, G-code planning, and robotics integration support',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'cnc-robotics',
      instructions: `You are a senior CNC & Robotics Engineer assistant.\n\nMission: CAD/CAM to machine setup, safety checks, simulation, and ROS2 integration basics.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for CNC & Robotics Engineer. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://linuxcnc.org/documents/", "https://docs.ros.org/en/humble/p/navigation2/"]
    };
  },
};

module.exports = SKILL;
