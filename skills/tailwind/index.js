const fs = require('fs');
const path = require('path');

const SKILL = {
  id: 'tailwind',
  name: 'Tailwind Design System',

  // Pre-built component templates
  components: {
    button: {
      primary: '<button class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">Button</button>',
      secondary: '<button class="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium">Button</button>',
      outline: '<button class="px-4 py-2 border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium">Button</button>',
      ghost: '<button class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors font-medium">Button</button>',
      danger: '<button class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium">Button</button>',
    },
    card: {
      basic: '<div class="bg-white rounded-xl shadow-md p-6 border border-gray-100"><h3 class="text-lg font-semibold mb-2">Title</h3><p class="text-gray-600">Content</p></div>',
      image: '<div class="bg-white rounded-xl shadow-md overflow-hidden"><img class="w-full h-48 object-cover" src="" alt=""><div class="p-6"><h3 class="text-lg font-semibold mb-2">Title</h3><p class="text-gray-600">Description</p></div></div>',
    },
    input: {
      text: '<input type="text" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="Enter text...">',
      search: '<div class="relative"><input type="search" class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Search..."><svg class="absolute left-3 top-2.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg></div>',
    },
    navbar: '<nav class="bg-white shadow-sm border-b border-gray-100"><div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div class="flex justify-between h-16 items-center"><div class="flex items-center space-x-8"><span class="text-xl font-bold text-gray-900">Logo</span><a href="#" class="text-gray-600 hover:text-gray-900">Home</a><a href="#" class="text-gray-600 hover:text-gray-900">About</a></div><button class="px-4 py-2 bg-blue-600 text-white rounded-lg">Sign In</button></div></div></nav>',
    modal: '<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div class="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6"><h2 class="text-xl font-bold mb-4">Modal Title</h2><p class="text-gray-600 mb-6">Modal content goes here.</p><div class="flex justify-end space-x-3"><button class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button><button class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Confirm</button></div></div></div>',
    alert: {
      success: '<div class="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center"><svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>Success message</div>',
      error: '<div class="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center"><svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>Error message</div>',
    },
  },

  // Design tokens
  tokens: {
    colors: {
      primary: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' },
      gray: { 50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827' },
    },
    spacing: { xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2rem', '2xl': '3rem' },
    borderRadius: { sm: '0.25rem', md: '0.5rem', lg: '0.75rem', xl: '1rem', full: '9999px' },
    shadows: { sm: '0 1px 2px rgba(0,0,0,0.05)', md: '0 4px 6px rgba(0,0,0,0.07)', lg: '0 10px 15px rgba(0,0,0,0.1)', xl: '0 20px 25px rgba(0,0,0,0.15)' },
  },

  async run(params) {
    const { action, component, variant, task, custom } = params;

    switch (action) {
      case 'get':
        return this.getComponent(component, variant);
      case 'list':
        return { components: Object.keys(this.components), tokens: Object.keys(this.tokens) };
      case 'tokens':
        return this.tokens;
      case 'generate':
      default:
        return this.generate(task || custom || 'Create a component');
    }
  },

  getComponent(name, variant) {
    const comp = this.components[name];
    if (!comp) return { error: `Component '${name}' not found. Available: ${Object.keys(this.components).join(', ')}` };

    if (typeof comp === 'object' && !variant) return { component: name, variants: Object.keys(comp), examples: comp };
    if (typeof comp === 'object' && variant) return { component: name, variant, html: comp[variant] || comp };
    return { component: name, html: comp };
  },

  generate(task) {
    return {
      action: 'generate',
      task,
      tokens: this.tokens,
      availableComponents: Object.keys(this.components),
      instructions: `Generate Tailwind CSS HTML for: "${task}"

Rules:
- Use Tailwind CSS classes only (no custom CSS)
- Use these colors: blue-600 for primary, gray-600 for text
- Responsive design (mobile-first)
- Use semantic HTML
- Include hover/focus states
- Return ONLY HTML code, no explanation`,
      systemPrompt: 'You are a Tailwind CSS expert. Generate clean, responsive, accessible UI components.',
    };
  },
};

module.exports = SKILL;
