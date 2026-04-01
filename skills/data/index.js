const SKILL = {
  id: 'data',
  name: 'Data Analysis',

  async run(params) {
    const { task, action, format } = params;

    switch (action) {
      case 'explore': return this.explore(task);
      case 'visualize': return this.visualize(task);
      case 'statistics': return this.statistics(task);
      case 'clean': return this.clean(task);
      case 'transform': return this.transform(task);
      case 'report': return this.report(task);
      default: return this.analyze(task || 'Analyze data');
    }
  },

  analyze(task) {
    return {
      instructions: `Perform complete data analysis for: "${task}"

Create a Python script with:
1. Data loading (pandas, support CSV/JSON/Excel)
2. Exploratory Data Analysis (EDA):
   - Shape, dtypes, missing values
   - Descriptive statistics
   - Distribution of each feature
   - Correlations
3. Visualizations:
   - Distribution plots (histogram, KDE)
   - Correlation heatmap
   - Box plots for outliers
   - Scatter plots for relationships
4. Key insights and findings
5. Recommendations

Use pandas, matplotlib, seaborn.
Return ONLY Python code.`,
      systemPrompt: `You are a senior data analyst. Tell the story behind the data.
Be thorough in EDA. Find patterns, anomalies, and actionable insights.
Always visualize before concluding. Use clear, labeled plots.`,
      model: 'llama-3.1-70b-versatile',
    };
  },

  explore(task) {
    return {
      instructions: `Write exploratory data analysis code for: "${task}"

Include:
- df.info(), df.describe(), df.shape
- Missing value analysis (count, percentage, pattern)
- Data type analysis
- Unique values per column
- Value counts for categoricals
- Correlation matrix
- Skewness and kurtosis

Return ONLY Python code with print statements for each finding.`,
      systemPrompt: 'You are an EDA expert. Systematically explore every aspect of the data.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  visualize(task) {
    return {
      instructions: `Create data visualizations for: "${task}"

Generate these plots:
1. Distribution plots (histogram + KDE) for numerical features
2. Bar charts for categorical features
3. Correlation heatmap
4. Box plots (detect outliers)
5. Scatter matrix / pair plot
6. Time series plot (if date columns exist)

Use matplotlib + seaborn.
Style: clean, labeled, professional (use sns.set_style('whitegrid')).
Save plots as PNG files.
Return ONLY Python code.`,
      systemPrompt: 'You are a data visualization expert. Make plots that tell a clear story. Label everything.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  statistics(task) {
    return {
      instructions: `Write statistical analysis code for: "${task}"

Include:
- Descriptive statistics (mean, median, mode, std, variance)
- Normality tests (Shapiro-Wilk, D'Agostino)
- Correlation tests (Pearson, Spearman)
- Hypothesis testing (t-test, chi-square, ANOVA)
- Confidence intervals
- Effect size calculations

Use scipy.stats.
Return ONLY Python code with interpretive comments.`,
      systemPrompt: 'You are a statistician. Always check assumptions before tests. Report p-values and effect sizes.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  clean(task) {
    return {
      instructions: `Write data cleaning code for: "${task}"

Handle:
- Missing values (strategy: drop, mean/median/mode, KNN, forward fill)
- Duplicates
- Outliers (IQR method, Z-score)
- Data type conversions
- String cleaning (strip, lowercase, remove special chars)
- Date parsing
- Inconsistent categories (merge similar)

Log every cleaning action.
Return ONLY Python code.`,
      systemPrompt: 'You are a data cleaning specialist. Preserve data integrity. Document every change.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  transform(task) {
    return {
      instructions: `Write data transformation code for: "${task}"

Include:
- Feature engineering (new columns from existing)
- Encoding (OneHot, Label, Target, Binary)
- Scaling (Standard, MinMax, Robust)
- Binning / discretization
- Log / Box-Cox transforms for skewed data
- Date features (day, month, year, dayofweek, is_weekend)
- Text features (TF-IDF, length, word count)

Return ONLY Python code.`,
      systemPrompt: 'You are a feature engineering expert. Create features that improve model performance.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  report(task) {
    return {
      instructions: `Generate a data analysis report for: "${task}"

Create a report with:
1. Executive Summary (key findings in 3-5 bullets)
2. Data Overview (shape, types, quality)
3. Key Metrics (important numbers)
4. Trends & Patterns
5. Anomalies & Outliers
6. Visualizations (describe what each shows)
7. Recommendations (actionable next steps)

Format as Markdown.
Return ONLY the report text.`,
      systemPrompt: 'You are a data storyteller. Make complex data understandable to non-technical stakeholders.',
      model: 'llama-3.1-70b-versatile',
    };
  },
};

module.exports = SKILL;
