// MLAnalyzer.js
// On-device Isolation Forest — v3 uses separate weekday / weekend models (temporal context).

let modelCache;
function getModel() {
  if (modelCache !== undefined) return modelCache;
  try {
    modelCache = require('./mindguard_model.json');
  } catch {
    modelCache = null;
  }
  return modelCache;
}

const FALLBACK_ML = {
  riskLevel: 'NORMAL',
  riskScore: 0,
  isAnomaly: false,
  mlScore: 0,
  deviations: [],
};

function pickBranch(modelData, dayType) {
  if (modelData?.weekday?.trees && modelData?.weekend?.trees) {
    return dayType === 'weekend' ? modelData.weekend : modelData.weekday;
  }
  return modelData;
}

function featureList(modelData, branch) {
  if (modelData.features && Array.isArray(modelData.features)) {
    return modelData.features;
  }
  return branch.scaler?.features || [];
}

function scaleInput(branch, features, sample) {
  const { mean, scale } = branch.scaler;
  return features.map((featureName, i) => {
    const raw = sample[featureName] !== undefined ? sample[featureName] : 0;
    const s = scale[i];
    const denom = s === 0 || s == null || Number.isNaN(s) ? 1 : s;
    const v = (raw - mean[i]) / denom;
    return Number.isFinite(v) ? v : 0;
  });
}

function traverseTree(nodes, scaledSample) {
  let idx = 0;
  let depth = 0;
  const maxSteps = Math.max(64, (nodes && nodes.length) || 0) + 8;
  while (nodes[idx] && !nodes[idx].is_leaf) {
    if (depth >= maxSteps) break;
    const node = nodes[idx];
    const fi = node.feature;
    const next =
      scaledSample[fi] != null && scaledSample[fi] <= node.threshold
        ? node.left
        : node.right;
    if (next == null || next === idx || next < 0 || next >= nodes.length) break;
    idx = next;
    depth += 1;
  }
  return depth;
}

function expectedPathLength(n) {
  if (n <= 1) return 0;
  return 2.0 * (Math.log(n - 1) + 0.5772156649) - (2.0 * (n - 1) / n);
}

function computeScore(branch, features, sample) {
  const scaled = scaleInput(branch, features, sample);
  const N_TRAIN = 90;
  const trees = branch.trees;
  if (!trees || !trees.length) return -0.4;

  const totalDepth = trees.reduce((sum, tree) => sum + traverseTree(tree, scaled), 0);
  const avgDepth = totalDepth / trees.length;
  const epl = expectedPathLength(N_TRAIN);
  const denom = epl > 0 ? epl : 1;
  const score = -Math.pow(2, -avgDepth / denom);
  return Number.isFinite(score) ? score : -0.4;
}

function scoreToRisk(score) {
  const SCORE_MIN = -0.7;
  const SCORE_MAX = -0.35;
  const riskPercent = Math.round(
    Math.min(100, Math.max(0, ((score - SCORE_MAX) / (SCORE_MIN - SCORE_MAX)) * 100))
  );
  let riskLevel;
  if (riskPercent >= 65) riskLevel = 'HIGH';
  else if (riskPercent >= 35) riskLevel = 'MODERATE';
  else riskLevel = 'NORMAL';
  return { riskPercent, riskLevel };
}

function buildRawSample(todayStats) {
  return {
    screenTime: todayStats.totalScreenTime || 0,
    socialTime: todayStats.socialAppTime || 0,
    nightUsage: todayStats.nightUsage || 0,
    commTime: todayStats.communicationTime || 0,
    entertainTime: todayStats.entertainmentTime || 0,
    appVariety: todayStats.appVarietyCount || 0,
    locationVariety: todayStats.locationVariety || 0,
    mobilityKm: todayStats.mobilityKm ?? todayStats.mobilityRadius ?? 0,
    homeStayDuration: todayStats.homeStayDuration || 0,
  };
}

function buildDeviations(sample, isWeekend) {
  const deviations = [];

  if (sample.screenTime > 0 && sample.screenTime < 150) {
    deviations.push('Screen time is significantly lower than your usual baseline.');
  }
  if (sample.socialTime < 30) {
    deviations.push('Social media usage has dropped sharply.');
  }
  if (sample.nightUsage > 60) {
    deviations.push('Night-time phone use is much higher than usual.');
  }
  if (sample.commTime < 20) {
    deviations.push('Communication app usage has dropped significantly.');
  }
  if (sample.entertainTime < 15) {
    deviations.push('Entertainment usage is much lower than usual.');
  }
  if (sample.appVariety < 6) {
    deviations.push('You used fewer unique apps than usual today.');
  }

  if (!isWeekend) {
    if (sample.locationVariety <= 1) {
      deviations.push('You stayed in one area all day on a weekday — less movement than typical.');
    }
    if (sample.mobilityKm < 0.5) {
      deviations.push('Very little travel between areas today for a weekday.');
    }
  } else {
    if (sample.locationVariety < 1 && sample.mobilityKm < 0.1) {
      deviations.push('Very little movement even for a weekend — worth a quick self check-in.');
    }
  }

  return deviations;
}

export function analyzeWithML(todayStats) {
  try {
    const modelData = getModel();
    if (!modelData) {
      return { ...FALLBACK_ML };
    }

    const dayType = todayStats.dayType === 'weekend' ? 'weekend' : 'weekday';
    const isWeekend = dayType === 'weekend';
    const branch = pickBranch(modelData, dayType);
    const features = featureList(modelData, branch);

    if (!branch?.scaler || !branch?.trees || !features.length) {
      return { ...FALLBACK_ML };
    }

    const threshold =
      branch.threshold != null ? branch.threshold : modelData.threshold;
    if (threshold == null) {
      return { ...FALLBACK_ML };
    }

    const sample = buildRawSample(todayStats);
    const score = computeScore(branch, features, sample);
    const isAnomaly = score < threshold;
    const { riskPercent, riskLevel } = scoreToRisk(score);
    const deviations = buildDeviations(sample, isWeekend);

    return {
      riskLevel,
      riskScore: riskPercent,
      isAnomaly,
      mlScore: parseFloat(Number(score).toFixed(4)),
      deviations,
      dayType,
    };
  } catch {
    return { ...FALLBACK_ML };
  }
}
