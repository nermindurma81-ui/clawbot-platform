const SKILL = {
  id: 'uiux',
  name: 'UI/UX Design',

  async run(params) {
    const { action, task, type, app_type } = params;

    switch (action) {
      case 'wireframe': return this.wireframe(task, app_type);
      case 'user-flow': return this.userFlow(task);
      case 'copy': return this.uxCopy(task, type);
      case 'audit': return this.audit(task);
      case 'design-system': return this.designSystem(task);
      default: return this.generate(task || 'Design a UI');
    }
  },

  wireframe(task, appType) {
    return {
      action: 'wireframe',
      task,
      instructions: `Create a detailed wireframe description for: "${task}"
App type: ${appType || 'web app'}

Return JSON format:
{
  "screen": "Screen Name",
  "layout": {
    "header": "description",
    "sidebar": "description (if any)",
    "main": "description of main content area",
    "footer": "description"
  },
  "components": [
    {
      "type": "navbar|card|button|input|list|modal|table|chart|form",
      "position": "top|left|center|right|bottom",
      "content": "what it contains",
      "interaction": "what happens on click/hover/input"
    }
  ],
  "responsive": {
    "mobile": "how it adapts",
    "tablet": "how it adapts"
  },
  "colorScheme": "light|dark|auto",
  "primaryActions": ["main user actions on this screen"]
}`,
      systemPrompt: 'You are a senior UI/UX designer. Design clean, intuitive, accessible interfaces. Focus on user needs and simplicity.',
    };
  },

  userFlow(task) {
    return {
      action: 'user-flow',
      task,
      instructions: `Design a user flow for: "${task}"

Return JSON:
{
  "flowName": "name",
  "entryPoint": "how user starts",
  "steps": [
    {
      "step": 1,
      "screen": "screen name",
      "userAction": "what user does",
      "systemResponse": "what app does",
      "decision": "if branching, what are the paths",
      "errorState": "what goes wrong and how to handle"
    }
  ],
  "exitPoints": ["how user completes or leaves"],
  "edgeCases": ["unusual scenarios to handle"]
}`,
      systemPrompt: 'You are a UX strategist. Design intuitive user journeys that minimize friction and maximize conversion.',
    };
  },

  uxCopy(task, type) {
    return {
      action: 'ux-copy',
      task,
      type: type || 'general',
      instructions: `Write UX microcopy for: "${task}"
Type: ${type || 'general (buttons, labels, tooltips, error messages, empty states)'}

Rules:
- Be concise (max 8 words for buttons, 15 for labels)
- Use active voice
- Be helpful, not robotic
- Include error states, empty states, success messages
- Return as JSON: { "element": "text", ... }`,
      systemPrompt: 'You are a UX writer. Write clear, concise, human microcopy.',
    };
  },

  audit(task) {
    return {
      action: 'audit',
      task,
      instructions: `Perform a UI/UX audit on: "${task}"

Check for:
1. Visual hierarchy — clear focus points
2. Spacing consistency — padding, margins aligned to grid
3. Typography — readable sizes, good contrast
4. Color accessibility — WCAG AA contrast ratios
5. Interaction states — hover, focus, active, disabled
6. Responsive design — mobile-first, breakpoints
7. Loading states — skeleton, spinner, progress
8. Error handling — inline errors, toast messages
9. Empty states — helpful guidance
10. Accessibility — ARIA labels, keyboard nav

Return a score (1-10) and detailed findings as JSON.`,
      systemPrompt: 'You are a UI/UX auditor. Be thorough, specific, and actionable.',
    };
  },

  designSystem(task) {
    return {
      action: 'design-system',
      task,
      instructions: `Create a design system for: "${task}"

Return JSON with:
{
  "colors": { "primary": "...", "secondary": "...", "accent": "...", "success": "...", "warning": "...", "error": "...", "neutral": ["..."] },
  "typography": { "fontFamily": "...", "headings": { "h1": "size/weight", "h2": "...", "h3": "..." }, "body": "size/line-height", "caption": "..." },
  "spacing": { "unit": "4px or 8px", "scale": [0, 1, 2, 3, 4, 6, 8, 12, 16] },
  "borderRadius": { "sm": "...", "md": "...", "lg": "...", "full": "..." },
  "shadows": { "sm": "...", "md": "...", "lg": "..." },
  "breakpoints": { "sm": "640px", "md": "768px", "lg": "1024px", "xl": "1280px" },
  "components": ["list of component names needed"]
}`,
      systemPrompt: 'You are a design systems architect. Create consistent, scalable design tokens.',
    };
  },

  generate(task) {
    return this.wireframe(task);
  },
};

module.exports = SKILL;
