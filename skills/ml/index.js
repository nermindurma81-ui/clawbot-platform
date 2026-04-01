const SKILL = {
  id: 'ml',
  name: 'ML Studio',

  async run(params) {
    const { task, action, framework, algorithm, dataset } = params;

    switch (action) {
      case 'pipeline': return this.pipeline(task, framework);
      case 'classify': return this.classify(task, algorithm);
      case 'regress': return this.regress(task, algorithm);
      case 'cluster': return this.cluster(task, algorithm);
      case 'deep-learning': return this.deepLearning(task, framework);
      case 'evaluate': return this.evaluate(task);
      case 'preprocess': return this.preprocess(task);
      default: return this.generate(task || 'Create ML pipeline');
    }
  },

  generate(task) {
    return {
      instructions: `Generate a complete machine learning solution for: "${task}"

Return a Python script with:
1. Data loading (use pandas, create synthetic if no dataset)
2. Preprocessing (handle missing values, encode categoricals, scale features)
3. Model selection and training
4. Evaluation (accuracy, precision, recall, F1 for classification / MSE, R² for regression)
5. Visualization (matplotlib/seaborn plots)
6. Predictions on new data

Use scikit-learn as default. Include all imports.
Return ONLY working Python code, no explanation.`,
      systemPrompt: `You are an expert ML engineer. Write production-quality machine learning code.
Always include: data validation, error handling, cross-validation, hyperparameter tuning.
Use best practices: train/test split, feature scaling, proper metrics.
Comment each section clearly.`,
      model: 'llama-3.1-70b-versatile',
    };
  },

  pipeline(task, framework = 'sklearn') {
    return {
      instructions: `Create a complete ${framework} ML pipeline for: "${task}"

Include:
- Data loading & exploration
- Feature engineering
- Model training with cross-validation
- Hyperparameter tuning (GridSearchCV or RandomizedSearchCV)
- Evaluation metrics
- Model serialization (joblib/pickle)
- Prediction function

Framework: ${framework}
Return ONLY Python code.`,
      systemPrompt: `You are an ML pipeline architect. Build robust, reusable pipelines.
Include Pipeline and ColumnTransformer from sklearn.
Handle both numerical and categorical features.
Use stratified splits for imbalanced data.`,
      model: 'llama-3.1-70b-versatile',
    };
  },

  classify(task, algorithm = 'auto') {
    const algorithms = {
      'auto': 'Try LogisticRegression, RandomForest, XGBoost and pick best',
      'logistic': 'LogisticRegression',
      'forest': 'RandomForestClassifier',
      'svm': 'SVC',
      'xgboost': 'XGBClassifier',
      'knn': 'KNeighborsClassifier',
      'naive-bayes': 'GaussianNB',
    };

    return {
      instructions: `Build a classification model for: "${task}"
Algorithm: ${algorithms[algorithm] || algorithm}

Include:
- Data exploration (class distribution, correlations)
- Handle imbalanced classes (SMOTE or class_weight)
- Feature selection
- Cross-validation
- Confusion matrix, ROC curve, classification report
- Save model

Return ONLY Python code.`,
      systemPrompt: 'You are a classification expert. Focus on model interpretability and avoiding overfitting.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  regress(task, algorithm = 'auto') {
    return {
      instructions: `Build a regression model for: "${task}"
Algorithm: ${algorithm === 'auto' ? 'Try LinearRegression, RandomForest, GradientBoosting and pick best' : algorithm}

Include:
- Feature engineering
- Cross-validation
- Metrics: MSE, RMSE, MAE, R²
- Residual plots
- Feature importance
- Save model

Return ONLY Python code.`,
      systemPrompt: 'You are a regression expert. Watch for multicollinearity, outliers, and heteroscedasticity.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  cluster(task, algorithm = 'kmeans') {
    return {
      instructions: `Build a clustering solution for: "${task}"
Algorithm: ${algorithm}

Include:
- Data preprocessing
- Elbow method / silhouette score for optimal k
- Cluster visualization (PCA/t-SNE for dimensionality reduction)
- Cluster profiling (what defines each cluster)
- Prediction on new data

Return ONLY Python code.`,
      systemPrompt: 'You are a clustering expert. Always validate cluster quality and interpret results.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  deepLearning(task, framework = 'pytorch') {
    return {
      instructions: `Build a deep learning model for: "${task}"
Framework: ${framework}

Include:
- Dataset class / DataLoader
- Model architecture (appropriate for task type)
- Training loop with early stopping
- Learning rate scheduling
- Metrics tracking
- Model checkpointing
- Visualization of training curves

Return ONLY Python code.`,
      systemPrompt: `You are a deep learning expert. Use ${framework === 'pytorch' ? 'PyTorch' : 'TensorFlow/Keras'} best practices.
Include GPU support, mixed precision if applicable, and proper weight initialization.`,
      model: 'llama-3.1-70b-versatile',
    };
  },

  evaluate(task) {
    return {
      instructions: `Write evaluation code for ML model: "${task}"

Include:
- Cross-validation scores
- Learning curves (detect overfitting/underfitting)
- Feature importance analysis
- Error analysis (what types of errors the model makes)
- Bias-variance tradeoff assessment
- Comparison with baseline model

Return ONLY Python code.`,
      systemPrompt: 'You are an ML evaluation expert. Be thorough and critical.',
      model: 'llama-3.1-70b-versatile',
    };
  },

  preprocess(task) {
    return {
      instructions: `Write data preprocessing code for: "${task}"

Include:
- Data loading and exploration (.info(), .describe(), .isnull())
- Handle missing values (strategy based on data type)
- Encode categorical variables (OneHot, Label, Target encoding)
- Feature scaling (StandardScaler, MinMaxScaler)
- Outlier detection and handling
- Feature engineering (interactions, polynomials if relevant)
- Train/test split

Return ONLY Python code.`,
      systemPrompt: 'You are a data preprocessing expert. Preserve data integrity, handle edge cases.',
      model: 'llama-3.1-70b-versatile',
    };
  },
};

module.exports = SKILL;
