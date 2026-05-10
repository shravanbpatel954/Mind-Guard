import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import json
import matplotlib.pyplot as plt

np.random.seed(42)

# ─── STEP 1: GENERATE SYNTHETIC DATA ───────────────────────────
# 8 features — no home location concept
# Two separate baselines: weekday vs weekend

def generate_normal_weekday():
    """Normal person on a weekday — goes to college/work"""
    return {
        'screenTime':      np.random.normal(300, 60),
        'socialTime':      np.random.normal(90, 30),
        'nightUsage':      np.random.normal(20, 15),
        'commTime':        np.random.normal(60, 20),
        'entertainTime':   np.random.normal(45, 20),
        'appVariety':      np.random.normal(15, 4),
        'locationVariety': np.random.normal(4, 1.5),  # college, canteen, home, market
        'mobilityKm':      np.random.normal(5.0, 2.0), # travels 5km avg on weekday
    }

def generate_normal_weekend():
    """Normal person on weekend — staying home is EXPECTED"""
    return {
        'screenTime':      np.random.normal(350, 70),   # more phone time
        'socialTime':      np.random.normal(120, 40),   # more social media
        'nightUsage':      np.random.normal(40, 20),    # stays up later
        'commTime':        np.random.normal(50, 20),
        'entertainTime':   np.random.normal(90, 30),    # more YouTube/games
        'appVariety':      np.random.normal(12, 4),
        'locationVariety': np.random.normal(2, 1.0),   # staying home = NORMAL
        'mobilityKm':      np.random.normal(1.5, 1.0), # less travel = NORMAL
    }

def generate_depressed_weekday():
    """Depressed person on weekday — skipping college, not going out"""
    return {
        'screenTime':      np.random.normal(120, 40),
        'socialTime':      np.random.normal(15, 10),
        'nightUsage':      np.random.normal(90, 30),
        'commTime':        np.random.normal(10, 8),
        'entertainTime':   np.random.normal(10, 8),
        'appVariety':      np.random.normal(5, 2),
        'locationVariety': np.random.normal(1, 0.5),   # skipping college
        'mobilityKm':      np.random.normal(0.3, 0.2), # barely moves
    }

def generate_depressed_weekend():
    """Depressed person on weekend — even more isolated than normal weekend"""
    return {
        'screenTime':      np.random.normal(100, 40),
        'socialTime':      np.random.normal(10, 8),
        'nightUsage':      np.random.normal(120, 40),
        'commTime':        np.random.normal(5, 5),
        'entertainTime':   np.random.normal(5, 5),
        'appVariety':      np.random.normal(3, 2),
        'locationVariety': np.random.normal(1, 0.3),   # doesn't even step out
        'mobilityKm':      np.random.normal(0.05, 0.05),
    }

# ─── GENERATE DATA ──────────────────────────────────────────────
# 90 days total: 65 weekdays + 25 weekends (realistic split)
normal_weekdays = [generate_normal_weekday() for _ in range(65)]
normal_weekends = [generate_normal_weekend() for _ in range(25)]
normal_days = normal_weekdays + normal_weekends
df_normal = pd.DataFrame(normal_days).clip(lower=0)

# 20 depressed days: 14 weekdays + 6 weekends
dep_weekdays = [generate_depressed_weekday() for _ in range(14)]
dep_weekends = [generate_depressed_weekend() for _ in range(6)]
depressed_days = dep_weekdays + dep_weekends
df_depressed = pd.DataFrame(depressed_days).clip(lower=0)

print("=== NORMAL DATA STATS (8 features, weekday/weekend split) ===")
print(df_normal.describe().round(1))

# ─── STEP 2: TRAIN TWO SEPARATE MODELS ─────────────────────────
# One for weekdays, one for weekends
# This way weekend baseline is different from weekday

df_weekday = pd.DataFrame(normal_weekdays).clip(lower=0)
df_weekend = pd.DataFrame(normal_weekends).clip(lower=0)

# Weekday model
scaler_weekday = StandardScaler()
X_weekday = scaler_weekday.fit_transform(df_weekday)
model_weekday = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
model_weekday.fit(X_weekday)

# Weekend model
scaler_weekend = StandardScaler()
X_weekend = scaler_weekend.fit_transform(df_weekend)
model_weekend = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
model_weekend.fit(X_weekend)

print("\n=== MODELS TRAINED ✅ ===")
print(f"Weekday model: trained on {len(df_weekday)} days")
print(f"Weekend model: trained on {len(df_weekend)} days")
print(f"Features: {df_normal.columns.tolist()}")

# ─── STEP 3: TEST ───────────────────────────────────────────────
print("\n=== WEEKDAY TEST CASES ===")
weekday_tests = [
    {
        'name': 'Normal weekday',
        'data': {'screenTime': 300, 'socialTime': 90, 'nightUsage': 15,
                 'commTime': 60, 'entertainTime': 45, 'appVariety': 15,
                 'locationVariety': 4, 'mobilityKm': 5.0}
    },
    {
        'name': 'Depressed weekday',
        'data': {'screenTime': 80, 'socialTime': 5, 'nightUsage': 150,
                 'commTime': 5, 'entertainTime': 5, 'appVariety': 3,
                 'locationVariety': 1, 'mobilityKm': 0.1}
    },
    {
        'name': 'Skipped college only',
        'data': {'screenTime': 310, 'socialTime': 95, 'nightUsage': 18,
                 'commTime': 65, 'entertainTime': 50, 'appVariety': 16,
                 'locationVariety': 1, 'mobilityKm': 0.2}
    },
    {
        'name': 'Low phone but went out',
        'data': {'screenTime': 180, 'socialTime': 50, 'nightUsage': 10,
                 'commTime': 30, 'entertainTime': 20, 'appVariety': 8,
                 'locationVariety': 5, 'mobilityKm': 8.0}
    },
]

for case in weekday_tests:
    df = pd.DataFrame([case['data']])
    scaled = scaler_weekday.transform(df)
    pred = model_weekday.predict(scaled)[0]
    score = model_weekday.score_samples(scaled)[0]
    result = 'NORMAL' if pred == 1 else 'ANOMALY'
    print(f"  {case['name']:30} → {result:8} score: {score:.3f}")

print("\n=== WEEKEND TEST CASES ===")
weekend_tests = [
    {
        'name': 'Normal weekend (home)',
        'data': {'screenTime': 350, 'socialTime': 120, 'nightUsage': 40,
                 'commTime': 50, 'entertainTime': 90, 'appVariety': 12,
                 'locationVariety': 2, 'mobilityKm': 1.5}
    },
    {
        'name': 'Active weekend (went out)',
        'data': {'screenTime': 280, 'socialTime': 100, 'nightUsage': 20,
                 'commTime': 60, 'entertainTime': 60, 'appVariety': 14,
                 'locationVariety': 5, 'mobilityKm': 6.0}
    },
    {
        'name': 'Depressed weekend',
        'data': {'screenTime': 80, 'socialTime': 5, 'nightUsage': 150,
                 'commTime': 3, 'entertainTime': 3, 'appVariety': 2,
                 'locationVariety': 1, 'mobilityKm': 0.02}
    },
    {
        'name': 'Weekend staying home',
        'data': {'screenTime': 360, 'socialTime': 130, 'nightUsage': 45,
                 'commTime': 55, 'entertainTime': 95, 'appVariety': 13,
                 'locationVariety': 1, 'mobilityKm': 0.5}
    },
]

for case in weekend_tests:
    df = pd.DataFrame([case['data']])
    scaled = scaler_weekend.transform(df)
    pred = model_weekend.predict(scaled)[0]
    score = model_weekend.score_samples(scaled)[0]
    result = 'NORMAL' if pred == 1 else 'ANOMALY'
    print(f"  {case['name']:30} → {result:8} score: {score:.3f}")

# ─── STEP 4: ACCURACY ───────────────────────────────────────────
dep_weekday_df = pd.DataFrame(dep_weekdays).clip(lower=0)
dep_weekend_df = pd.DataFrame(dep_weekends).clip(lower=0)

wday_normal_acc  = sum(model_weekday.predict(scaler_weekday.transform(df_weekday))  == 1) / len(df_weekday)  * 100
wday_anomaly_acc = sum(model_weekday.predict(scaler_weekday.transform(dep_weekday_df)) == -1) / len(dep_weekday_df) * 100
wend_normal_acc  = sum(model_weekend.predict(scaler_weekend.transform(df_weekend))  == 1) / len(df_weekend)  * 100
wend_anomaly_acc = sum(model_weekend.predict(scaler_weekend.transform(dep_weekend_df)) == -1) / len(dep_weekend_df) * 100

print(f"\n=== ACCURACY ===")
print(f"Weekday model → Normal: {wday_normal_acc:.1f}%  Anomaly: {wday_anomaly_acc:.1f}%")
print(f"Weekend model → Normal: {wend_normal_acc:.1f}%  Anomaly: {wend_anomaly_acc:.1f}%")

# ─── STEP 5: EXPORT JSON ────────────────────────────────────────
def export_tree(tree):
    t = tree.tree_
    nodes = []
    for i in range(t.node_count):
        nodes.append({
            'feature':   int(t.feature[i]),
            'threshold': float(t.threshold[i]),
            'left':      int(t.children_left[i]),
            'right':     int(t.children_right[i]),
            'is_leaf':   bool(t.children_left[i] == -1)
        })
    return nodes

def package_model(model, scaler, df_train, label):
    return {
        'label':         label,
        'n_estimators':  model.n_estimators,
        'threshold':     float(model.offset_),
        'scaler': {
            'mean':  scaler.mean_.tolist(),
            'scale': scaler.scale_.tolist(),
        },
        'trees': [export_tree(e) for e in model.estimators_],
    }

model_json = {
    'version':   '3.0',
    'algorithm': 'IsolationForest',
    'features':  df_normal.columns.tolist(),
    'note':      'Two separate models: weekday and weekend baselines',
    'weekday':   package_model(model_weekday, scaler_weekday, df_weekday, 'weekday'),
    'weekend':   package_model(model_weekend, scaler_weekend, df_weekend, 'weekend'),
}

with open('mindguard_model.json', 'w') as f:
    json.dump(model_json, f)

size_kb = len(json.dumps(model_json)) / 1024
print(f"\n✅ Model exported → mindguard_model.json")
print(f"   Version  : 3.0 (weekday/weekend split)")
print(f"   Features : {df_normal.columns.tolist()}")
print(f"   File size: {size_kb:.1f} KB")

# ─── STEP 6: VISUALIZATION ──────────────────────────────────────
fig, axes = plt.subplots(1, 2, figsize=(15, 5))

# Plot 1 — Score distributions
wday_normal_scores  = model_weekday.score_samples(scaler_weekday.transform(df_weekday))
wday_anomaly_scores = model_weekday.score_samples(scaler_weekday.transform(dep_weekday_df))
wend_normal_scores  = model_weekend.score_samples(scaler_weekend.transform(df_weekend))
wend_anomaly_scores = model_weekend.score_samples(scaler_weekend.transform(dep_weekend_df))

axes[0].hist(wday_normal_scores,  bins=15, alpha=0.6, color='#22c55e', label='Weekday normal')
axes[0].hist(wday_anomaly_scores, bins=10, alpha=0.6, color='#ef4444', label='Weekday anomaly')
axes[0].hist(wend_normal_scores,  bins=10, alpha=0.6, color='#86efac', label='Weekend normal')
axes[0].hist(wend_anomaly_scores, bins=5,  alpha=0.6, color='#fca5a5', label='Weekend anomaly')
axes[0].axvline(x=model_weekday.offset_, color='orange', linestyle='--', linewidth=2, label='Threshold')
axes[0].set_title('Anomaly Scores — Weekday/Weekend Split', fontsize=13, fontweight='bold')
axes[0].set_xlabel('Anomaly Score')
axes[0].set_ylabel('Days')
axes[0].legend(fontsize=8)
axes[0].grid(True, alpha=0.3)

# Plot 2 — Feature comparison
features_short = ['Screen', 'Social', 'Night', 'Comm', 'Entertain', 'Variety', 'Loc.Places', 'Mobility']
x = range(len(features_short))
width = 0.2

axes[1].bar([i - 1.5*width for i in x], df_weekday.mean(),     width, label='Weekday normal',   color='#22c55e', alpha=0.85)
axes[1].bar([i - 0.5*width for i in x], dep_weekday_df.mean(), width, label='Weekday depressed', color='#ef4444', alpha=0.85)
axes[1].bar([i + 0.5*width for i in x], df_weekend.mean(),     width, label='Weekend normal',   color='#86efac', alpha=0.85)
axes[1].bar([i + 1.5*width for i in x], dep_weekend_df.mean(), width, label='Weekend depressed', color='#fca5a5', alpha=0.85)
axes[1].set_title('Feature Comparison Across All Day Types', fontsize=13, fontweight='bold')
axes[1].set_xticks(x)
axes[1].set_xticklabels(features_short, rotation=45, ha='right')
axes[1].set_ylabel('Value')
axes[1].legend(fontsize=8)
axes[1].grid(True, alpha=0.3, axis='y')

plt.tight_layout()
plt.savefig('model_visualization_v3.png', dpi=150, bbox_inches='tight')
plt.show()
print("Chart saved → model_visualization_v3.png")
