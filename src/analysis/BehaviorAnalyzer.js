export const calculateBaseline = (history) => {
  if (!history || history.length === 0) return null;

  const sum = history.reduce(
    (acc, curr) => ({
      totalScreenTime: acc.totalScreenTime + (curr.totalScreenTime || 0),
      socialAppTime: acc.socialAppTime + (curr.socialAppTime || 0),
      communicationTime: acc.communicationTime + (curr.communicationTime || 0),
      entertainmentTime: acc.entertainmentTime + (curr.entertainmentTime || 0),
      appVarietyCount: acc.appVarietyCount + (curr.appVarietyCount || 0),
      appLaunches: acc.appLaunches + (curr.appLaunches || 0),
      nightUsage: acc.nightUsage + (curr.nightUsage || 0),
      locationVariety: acc.locationVariety + (curr.locationVariety || 0),
      mobilityRadius: acc.mobilityRadius + (curr.mobilityRadius || 0),
    }),
    {
      totalScreenTime: 0,
      socialAppTime: 0,
      communicationTime: 0,
      entertainmentTime: 0,
      appVarietyCount: 0,
      appLaunches: 0,
      nightUsage: 0,
      locationVariety: 0,
      mobilityRadius: 0,
    }
  );

  const count = history.length;
  return {
    totalScreenTime: Math.round(sum.totalScreenTime / count),
    socialAppTime: Math.round(sum.socialAppTime / count),
    communicationTime: Math.round(sum.communicationTime / count),
    entertainmentTime: Math.round(sum.entertainmentTime / count),
    appVarietyCount: Math.round(sum.appVarietyCount / count),
    appLaunches: Math.round(sum.appLaunches / count),
    nightUsage: Math.round(sum.nightUsage / count),
    locationVariety: Math.round(sum.locationVariety / count),
    mobilityRadius: Math.round((sum.mobilityRadius / count) * 10) / 10,
  };
};

export const analyzeBehavior = (currentStats, baseline) => {
  let riskScore = 0;
  const deviations = [];

  if (!baseline) {
    return { riskLevel: 'NORMAL', riskScore: 0, deviations: [] };
  }

  // Screen time
  if (currentStats.totalScreenTime > baseline.totalScreenTime * 1.5) {
    riskScore += 2;
    deviations.push(`Screen time is 50% higher than your average.`);
  } else if (currentStats.totalScreenTime > baseline.totalScreenTime * 1.2) {
    riskScore += 1;
    deviations.push(`Screen time is slightly above your average.`);
  }

  // Social
  if (currentStats.socialAppTime > baseline.socialAppTime * 1.5) {
    riskScore += 2;
    deviations.push(`Social media usage is significantly higher than usual.`);
  } else if (currentStats.socialAppTime > baseline.socialAppTime * 1.2) {
    riskScore += 1;
    deviations.push(`Social media usage is slightly above your average.`);
  }

  // App launches
  if (currentStats.appLaunches > baseline.appLaunches * 1.5) {
    riskScore += 1;
    deviations.push(`You are checking your phone more frequently today.`);
  }

  // Night usage
  if (currentStats.nightUsage > baseline.nightUsage * 1.5) {
    riskScore += 2;
    deviations.push(`High late-night phone usage detected.`);
  } else if (currentStats.nightUsage > baseline.nightUsage * 1.2) {
    riskScore += 1;
    deviations.push(`Late-night phone usage is above average.`);
  }

  // Communication (withdrawal — sharp drop vs your norm)
  if (
    baseline.communicationTime >= 5 &&
    currentStats.communicationTime < baseline.communicationTime * 0.5
  ) {
    riskScore += 1;
    deviations.push(
      `Time in messaging & phone apps is much lower than your usual — a pattern sometimes linked to social withdrawal.`
    );
  }

  // Entertainment / games (anhedonia — sharp drop)
  if (
    baseline.entertainmentTime >= 5 &&
    currentStats.entertainmentTime < baseline.entertainmentTime * 0.5
  ) {
    riskScore += 1;
    deviations.push(
      `Entertainment & game usage is much lower than your usual — sometimes linked to reduced interest or pleasure in activities.`
    );
  }

  // App variety (narrowing — fewer distinct apps)
  if (
    baseline.appVarietyCount >= 4 &&
    currentStats.appVarietyCount < baseline.appVarietyCount * 0.6
  ) {
    riskScore += 1;
    deviations.push(
      `You're using fewer different apps than usual — sometimes linked to narrowed behaviour patterns.`
    );
  }

  riskScore = Math.min(riskScore, 7);

  let riskLevel = 'NORMAL';
  if (riskScore >= 5) {
    riskLevel = 'HIGH';
  } else if (riskScore >= 3) {
    riskLevel = 'MODERATE';
  }

  return { riskLevel, riskScore, deviations };
};
