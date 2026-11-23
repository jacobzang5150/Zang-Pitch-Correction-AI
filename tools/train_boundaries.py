"""Fit a compact onset classifier with generated 130 ms vocal contour examples.
Only needed when changing the classifier. Runtime inference is plain JavaScript.
"""
from pathlib import Path
import json
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score

rng = np.random.default_rng(5150)
t = np.arange(-6, 7) * .01
features, labels = [], []
for i in range(24000):
    boundary = (i % 2) == 0
    center = rng.uniform(-.012, .012)
    vib = rng.uniform(0, .52) * np.sin(2*np.pi*rng.uniform(4, 8)*t + rng.uniform(0, 6.28))
    slope = rng.uniform(-8, 8) * t
    pitch = vib + slope + rng.normal(0, .045, len(t))
    energy = 1 + .10 * np.sin(24*t + rng.uniform(0, 6.28))
    if boundary:
        step = rng.choice([-1, 1]) * rng.choice([0, 1, 2, 3, 4, 5, 7])
        pitch += step / (1 + np.exp(-(t-center)/rng.uniform(.003,.011)))
        depth = rng.uniform(.64,.96) if step == 0 else rng.uniform(0,.85)
        energy -= depth * np.exp(-((t-center)/.016)**2)
    else:
        energy -= rng.uniform(0,.39) * np.exp(-((t-center)/.021)**2)
    left, right = pitch[:5], pitch[-5:]
    features.append([abs(np.median(right)-np.median(left)),
                     min(1.0, max(0., 1-min(energy[4:9])/max(.001,(np.mean(energy[:4])+np.mean(energy[-4:]))*.5))),
                     abs(np.mean(pitch[7:9])-np.mean(pitch[4:6])),
                     np.std(left)+np.std(right)])
    labels.append(int(boundary))

x, y = np.array(features), np.array(labels)
model = LogisticRegression(C=3, max_iter=300).fit(x[:20000],y[:20000])
print("Held-out synthetic balanced accuracy:", balanced_accuracy_score(y[20000:],model.predict(x[20000:])))
weights = dict(bias=round(float(model.intercept_[0]),7), weights=np.round(model.coef_[0],7).tolist())
out = Path(__file__).resolve().parents[1]/"src"/"boundary-model.js"
out.write_text("const BOUNDARY_MODEL = "+json.dumps(weights)+";\n")
