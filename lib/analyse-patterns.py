#!/usr/bin/env python3
"""
Design Intelligence — Phase 2: Statistical Pattern Discovery

Reads features.json, runs three analyses per industry:
  1. Percentile profiling (top 10% vs bottom 50%)
  2. Decision tree rules (depth-4, human-readable)
  3. Archetypal analysis (3-5 distinctive types per industry)

Server: GhostPost VPS (78.111.89.140)
Run: python3 lib/analyse-patterns.py
Install: pip install scikit-learn scipy numpy pandas --break-system-packages
Time: Under 30 seconds for all industries
Output: data/statistics/*.json
"""

import json
import os
import sys
import warnings
from pathlib import Path
from collections import Counter

warnings.filterwarnings('ignore')

# Check dependencies
try:
    import numpy as np
    import pandas as pd
    from scipy import stats
    from sklearn.tree import DecisionTreeClassifier, export_text
    from sklearn.preprocessing import LabelEncoder
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install: pip install scikit-learn scipy numpy pandas --break-system-packages")
    sys.exit(1)

ROOT = Path(__file__).parent.parent
FEATURES_FILE = ROOT / "data" / "features.json"
STATS_DIR = ROOT / "data" / "statistics"

# Minimum sites per industry for meaningful statistics
MIN_SITES = 15

# Numeric features for statistical analysis
NUMERIC_FEATURES = [
    'quality_score', 'colour_count', 'font_family_count',
    'hero_height_pct', 'section_count',
    'visual_complexity', 'colourfulness', 'prototypicality',
    'warmth', 'typography_weight', 'image_dominance',
    'contrast_level', 'layout_density'
]

# Categorical features
CATEGORICAL_FEATURES = [
    'theme', 'heading_style', 'heading_weight', 'body_style',
    'hero_type', 'nav_type', 'card_style', 'cta_shape',
    'whitespace_level', 'grid_style'
]

# Boolean features
BOOLEAN_FEATURES = [
    'has_gallery', 'has_testimonials', 'has_pricing',
    'has_video', 'has_animation', 'has_glassmorphism',
    'has_gradient', 'has_parallax'
]

# Industry groupings for small samples
INDUSTRY_GROUPS = {
    'hair_services': ['barbershop', 'barber', 'hair_salon', 'beauty_salon', 'nail_salon'],
    'health_wellness': ['gym', 'personal_trainer', 'yoga_pilates', 'spa_wellness'],
    'medical': ['aesthetics_clinic', 'dental', 'physiotherapy', 'veterinary'],
    'food_drink': ['restaurant', 'cafe'],
    'creative': ['photography', 'tattoo_piercing', 'portfolio', 'agency'],
    'tech': ['saas', 'ecommerce'],
}


def load_features():
    """Load and validate features."""
    if not FEATURES_FILE.exists():
        print(f"ERROR: {FEATURES_FILE} not found. Run extract-features.js first.")
        sys.exit(1)

    with open(FEATURES_FILE) as f:
        features = json.load(f)

    print(f"Loaded {len(features)} features")
    return features


def group_by_industry(features):
    """Group features by industry. Merge small industries into parent groups."""
    by_industry = {}

    # First pass: direct industry
    for f in features:
        ind = f.get('industry', 'other')
        if ind not in by_industry:
            by_industry[ind] = []
        by_industry[ind].append(f)

    # Second pass: merge small industries into groups
    grouped = {}
    ungrouped_industries = set(by_industry.keys())

    for group_name, members in INDUSTRY_GROUPS.items():
        group_sites = []
        for member in members:
            if member in by_industry:
                group_sites.extend(by_industry[member])
                ungrouped_industries.discard(member)
        if len(group_sites) >= MIN_SITES:
            grouped[group_name] = group_sites
        elif group_sites:
            # Still too small even grouped — add to 'other'
            if 'other' not in grouped:
                grouped['other'] = []
            grouped['other'].extend(group_sites)

    # Add ungrouped industries that are big enough on their own
    for ind in ungrouped_industries:
        sites = by_industry[ind]
        if len(sites) >= MIN_SITES:
            grouped[ind] = sites
        else:
            if 'other' not in grouped:
                grouped['other'] = []
            grouped['other'].extend(sites)

    # Also keep individual industries for reporting even if grouped
    result = {}
    for name, sites in grouped.items():
        if len(sites) >= MIN_SITES:
            result[name] = sites

    return result


def percentile_profiling(sites, industry):
    """Compare top 10% vs bottom 50% on every feature."""
    df = pd.DataFrame(sites)

    if 'quality_score' not in df.columns:
        return None

    df['quality_score'] = pd.to_numeric(df['quality_score'], errors='coerce')
    df = df.dropna(subset=['quality_score'])

    if len(df) < MIN_SITES:
        return None

    q90 = df['quality_score'].quantile(0.9)
    q50 = df['quality_score'].quantile(0.5)

    top = df[df['quality_score'] >= q90]
    bottom = df[df['quality_score'] <= q50]

    if len(top) < 3 or len(bottom) < 3:
        return None

    results = {
        'industry': industry,
        'total_sites': len(df),
        'top_count': len(top),
        'bottom_count': len(bottom),
        'top_threshold': float(q90),
        'bottom_threshold': float(q50),
        'significant_differences': [],
        'categorical_differences': [],
        'boolean_differences': [],
    }

    # Numeric features
    for feat in NUMERIC_FEATURES:
        if feat not in df.columns or feat == 'quality_score':
            continue
        top_vals = pd.to_numeric(top[feat], errors='coerce').dropna()
        bot_vals = pd.to_numeric(bottom[feat], errors='coerce').dropna()

        if len(top_vals) < 3 or len(bot_vals) < 3:
            continue

        try:
            t_stat, p_val = stats.ttest_ind(top_vals, bot_vals, equal_var=False)
            if p_val < 0.1:  # Relaxed for small samples
                results['significant_differences'].append({
                    'feature': feat,
                    'top_mean': round(float(top_vals.mean()), 2),
                    'bottom_mean': round(float(bot_vals.mean()), 2),
                    'difference': round(float(top_vals.mean() - bot_vals.mean()), 2),
                    'p_value': round(float(p_val), 4),
                    'direction': 'higher' if top_vals.mean() > bot_vals.mean() else 'lower',
                })
        except Exception:
            pass

    # Categorical features
    for feat in CATEGORICAL_FEATURES:
        if feat not in df.columns:
            continue
        top_counts = Counter(top[feat].dropna())
        bot_counts = Counter(bottom[feat].dropna())

        top_total = sum(top_counts.values())
        bot_total = sum(bot_counts.values())

        if top_total == 0 or bot_total == 0:
            continue

        top_dist = {k: round(v / top_total * 100, 1) for k, v in top_counts.most_common(5)}
        bot_dist = {k: round(v / bot_total * 100, 1) for k, v in bot_counts.most_common(5)}

        results['categorical_differences'].append({
            'feature': feat,
            'top_distribution': top_dist,
            'bottom_distribution': bot_dist,
        })

    # Boolean features
    for feat in BOOLEAN_FEATURES:
        if feat not in df.columns:
            continue
        top_pct = round(float(top[feat].sum() / len(top) * 100), 1) if len(top) > 0 else 0
        bot_pct = round(float(bottom[feat].sum() / len(bottom) * 100), 1) if len(bottom) > 0 else 0

        if abs(top_pct - bot_pct) > 10:  # Only report meaningful differences
            results['boolean_differences'].append({
                'feature': feat,
                'top_pct': top_pct,
                'bottom_pct': bot_pct,
                'difference': round(top_pct - bot_pct, 1),
            })

    # Sort by significance
    results['significant_differences'].sort(key=lambda x: x['p_value'])
    results['boolean_differences'].sort(key=lambda x: abs(x['difference']), reverse=True)

    return results


def decision_tree_rules(sites, industry):
    """Train a depth-4 decision tree and extract human-readable rules."""
    df = pd.DataFrame(sites)

    if 'quality_score' not in df.columns:
        return None

    # Prepare features
    feature_cols = []
    for feat in NUMERIC_FEATURES:
        if feat != 'quality_score' and feat in df.columns:
            df[feat] = pd.to_numeric(df[feat], errors='coerce')
            feature_cols.append(feat)

    # Encode categoricals
    encoders = {}
    for feat in CATEGORICAL_FEATURES:
        if feat in df.columns:
            le = LabelEncoder()
            df[feat + '_enc'] = le.fit_transform(df[feat].fillna('unknown').astype(str))
            feature_cols.append(feat + '_enc')
            encoders[feat] = le

    # Encode booleans
    for feat in BOOLEAN_FEATURES:
        if feat in df.columns:
            df[feat] = df[feat].astype(int)
            feature_cols.append(feat)

    df = df.dropna(subset=['quality_score'])
    X = df[feature_cols].fillna(0)
    y = (df['quality_score'] >= df['quality_score'].quantile(0.75)).astype(int)

    if len(X) < MIN_SITES or y.sum() < 3:
        return None

    try:
        tree = DecisionTreeClassifier(max_depth=4, min_samples_leaf=max(3, len(X) // 20))
        tree.fit(X, y)

        # Extract rules as text
        rules_text = export_text(tree, feature_names=feature_cols, max_depth=4)

        # Feature importance
        importances = list(zip(feature_cols, tree.feature_importances_))
        importances.sort(key=lambda x: x[1], reverse=True)
        top_features = [(f, round(float(imp), 3)) for f, imp in importances if imp > 0.01]

        return {
            'industry': industry,
            'total_sites': len(X),
            'quality_threshold': float(round(df['quality_score'].quantile(0.75), 1)),
            'tree_accuracy': round(float(tree.score(X, y)), 3),
            'rules_text': rules_text,
            'top_features': top_features[:10],
        }
    except Exception as e:
        print(f"  Decision tree error: {e}")
        return None


def archetypal_analysis(sites, industry, n_archetypes=3):
    """Find distinctive design archetypes using clustering (K-Medoids fallback)."""
    df = pd.DataFrame(sites)

    features_to_use = [f for f in NUMERIC_FEATURES + BOOLEAN_FEATURES if f in df.columns and f != 'quality_score']

    for f in features_to_use:
        df[f] = pd.to_numeric(df[f], errors='coerce')

    df_clean = df[features_to_use].dropna()

    if len(df_clean) < n_archetypes * 5:
        return None

    # Normalise
    from sklearn.preprocessing import StandardScaler
    from sklearn.cluster import KMeans

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(df_clean)

    # Use KMeans as a practical alternative to archetypal analysis
    # (py_pcha may not be installed, KMeans finds representative centres)
    n_clusters = min(n_archetypes, len(X_scaled) // 5)
    if n_clusters < 2:
        return None

    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(X_scaled)

    # Describe each archetype
    archetypes = []
    for i in range(n_clusters):
        cluster_mask = labels == i
        cluster_df = df_clean[cluster_mask]
        cluster_original = df.iloc[cluster_mask.nonzero()[0]] if hasattr(cluster_mask, 'nonzero') else df[cluster_mask]

        if len(cluster_df) < 3:
            continue

        profile = {}
        for feat in features_to_use:
            profile[feat] = round(float(cluster_df[feat].mean()), 2)

        # Get most common categorical values
        cat_profile = {}
        for feat in CATEGORICAL_FEATURES:
            if feat in df.columns:
                vals = df.iloc[cluster_mask.nonzero()[0] if hasattr(cluster_mask, 'nonzero') else cluster_mask][feat].dropna()
                if len(vals) > 0:
                    cat_profile[feat] = vals.mode().iloc[0] if len(vals.mode()) > 0 else 'unknown'

        avg_quality = float(cluster_original['quality_score'].mean()) if 'quality_score' in cluster_original.columns else 0

        archetypes.append({
            'archetype_id': i + 1,
            'size': int(cluster_df.shape[0]),
            'avg_quality': round(avg_quality, 1),
            'numeric_profile': profile,
            'categorical_profile': cat_profile,
        })

    archetypes.sort(key=lambda x: x['avg_quality'], reverse=True)

    return {
        'industry': industry,
        'total_sites': len(df_clean),
        'n_archetypes': len(archetypes),
        'archetypes': archetypes,
    }


def main():
    print('═══════════════════════════════════════')
    print('  Phase 2: Statistical Discovery')
    print('═══════════════════════════════════════\n')

    features = load_features()

    if len(features) < MIN_SITES:
        print(f'Need at least {MIN_SITES} features. Have {len(features)}. Run extract-features.js first.')
        sys.exit(1)

    # Group by industry
    grouped = group_by_industry(features)
    print(f"\nIndustries with {MIN_SITES}+ sites:")
    for ind, sites in sorted(grouped.items(), key=lambda x: len(x[1]), reverse=True):
        print(f"  {ind}: {len(sites)} sites")

    # Create output directory
    STATS_DIR.mkdir(parents=True, exist_ok=True)

    # Run analyses per industry
    for industry, sites in grouped.items():
        print(f"\n▸ {industry} ({len(sites)} sites)")

        result = {
            'industry': industry,
            'site_count': len(sites),
            'generated_at': __import__('datetime').datetime.now().isoformat(),
        }

        # 1. Percentile profiling
        print("  Running percentile profiling...")
        pp = percentile_profiling(sites, industry)
        if pp:
            result['percentile_profiling'] = pp
            sig_count = len(pp['significant_differences'])
            print(f"  ✓ {sig_count} significant differences found")
        else:
            print("  ✗ Not enough data for profiling")

        # 2. Decision trees
        print("  Training decision tree...")
        dt = decision_tree_rules(sites, industry)
        if dt:
            result['decision_tree'] = dt
            print(f"  ✓ Accuracy: {dt['tree_accuracy']} | Top feature: {dt['top_features'][0][0] if dt['top_features'] else 'none'}")
        else:
            print("  ✗ Not enough data for decision tree")

        # 3. Archetypal analysis
        print("  Running archetypal analysis...")
        aa = archetypal_analysis(sites, industry)
        if aa:
            result['archetypes'] = aa
            for a in aa['archetypes']:
                print(f"  ✓ Archetype {a['archetype_id']}: {a['size']} sites, avg quality {a['avg_quality']}")
        else:
            print("  ✗ Not enough data for archetypes")

        # Save
        output_file = STATS_DIR / f"{industry}.json"
        with open(output_file, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"  Saved: {output_file}")

    # Summary
    print('\n═══════════════════════════════════════')
    print(f'  Industries analysed: {len(grouped)}')
    print(f'  Output: {STATS_DIR}/')
    print('  Next: node lib/synthesise-playbooks.js')


if __name__ == '__main__':
    main()
