# Food Delivery Delay & Dispatch Estimator

An AI/ML lab project on the 45,584-row Kaggle food delivery dataset. It predicts delivery time and delay risk, groups orders into clusters, and plans multi-stop delivery trips across Mumbai with A* search, all in a small Flask web app.

---

## Quick start

### 1. What you need

- **Python 3.10 or newer.** Check with `python3 --version` (on Windows, `py --version`).
- **Git**
- **An internet connection** while using the app. The charts, map tiles and street routes load from public servers. No accounts or API keys are needed.

### 2. Get the code

```bash
git clone https://github.com/sarthpatkar/Food-Delivery-Delay-and-Order-Dispatch-Estimator.git
cd Food-Delivery-Delay-and-Order-Dispatch-Estimator
```

The datasets are in the repo under `dataset/`, so there's nothing extra to download.

### 3. Create a virtual environment and install packages

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows (PowerShell):

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If PowerShell blocks the activate script, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and try again, or use Command Prompt with `.venv\Scripts\activate.bat`.

### 4. Run it

```bash
python run.py
```

Open **http://127.0.0.1:5000** in Chrome, Edge, Firefox or Safari. The first page load takes about 5 to 10 seconds while the models train. After that, everything responds immediately.

Stop the server with `Ctrl+C`. Next time, just activate the virtual environment (step 3, second line) and run `python run.py` again.

### Troubleshooting

| Problem | Fix |
|---|---|
| `Address already in use` / port 5000 busy (common on macOS, where AirPlay Receiver uses it) | Run on another port: `PORT=5050 python run.py` (Windows PowerShell: `$env:PORT=5050; python run.py`), then open http://127.0.0.1:5050 |
| `ModuleNotFoundError` | The virtual environment isn't active. Activate it and run again. |
| `python` not found | Use `python3` on macOS / Linux or `py` on Windows. |
| Map or charts are blank | Check your internet connection. The map, tiles and chart library load from CDNs. |
| Route lines are straight instead of following streets | The public OSRM router was unreachable at startup; the console shows `OSRM unreachable`. Restart the server when you're online. |

---

## Using the app

- **Predict (`/`)**
  - Set the order details. The predicted delivery time, delay probability and four classifier votes update live.
  - Under *Trip in Mumbai*, pick a pickup point and one drop-off per order on the trip. *Other orders on the trip* controls how many drop-off fields appear.
  - The distance input fills in automatically with the straight-line pickup to drop-off 1 distance, which is how the training data measures it. You can drag it to override.
  - The map shows the A* trip on real streets, the Greedy path for comparison, and how busy each road is.
- **Retrain (`/retrain`)**
  - Add `food_delivery_orders.csv`, `food_delivery_times.csv` or your own CSV to the training data and refit every model.
  - Scores before and after are shown side by side.
  - A custom CSV needs a delivery time column, such as `Time_taken (min)`, `delivery_time_min` or `actual_delivery_minutes`.
- **Models (`/explain`)**: confusion matrix, ROC curve, 5-fold cross-validation, K-Means elbow, PCA clusters, feature importance, decision tree rules and the A* cost formula.

---

## Frontend

The interface is an editorial design: sage-stone ground, forest ink type, one rationed tangerine accent, square corners, 1.5px ink rules, and a dark forest loam ground for the scroll stages. Only the frontend changed in this redesign. `web/app.py`, `src/`, the data and the models are untouched.

**Design tokens** (`web/static/css/style.css`, `:root`)
- Palette: sage-stone `#eaede4`, forest ink `#13231b`, tangerine `#e2682e` (the variable is still named `--red`), deep tangerine `#a8461c`, paper `#fbfcf7`, forest loam `#15291f`, saffron `#c98a12`, green `#3e7a56`. These were chosen by the assistant. To change the theme, edit the values in the `:root` block.
- Type: Anton for display headings, Inter for body text, Martian Mono for labels, numbers and status lines. Fonts load from Google Fonts with system fallbacks.
- Chart and route colours reuse the same variables, so Plotly and the map follow the palette.

**Predict page (`/`)** opens with five full-width stages, then the working tool:
1. Hero: a poster lockup over drifting red strokes. Three variables move the title (vertical position, scale, opacity).
2. Manifesto: one sentence that fills from the bottom as you scroll.
3. Method rail: six cards that slide sideways with scroll position.
4. Dispatch slip: a paper slip that prints itself, with cues that light up one at a time and live values from the prediction.
5. Season band: a contour plate with three chapters that highlight in turn.

The tool (form, prediction, route map, classifier votes, A* table) follows and works exactly as before.

**Motion**
- Only `transform` and `opacity` animate, plus `clip-path` for the manifesto fill.
- Headings split into words that rise in sequence. Cards and rows fade in as they scroll into view.
- Scroll-linked values are written to CSS variables by one passive scroll listener, batched with `requestAnimationFrame` (`web/static/js/motion.js`).
- Canvas loops run only while their section is on screen and the tab is visible.
- Charts draw in once when they first appear. The A* route draws segment by segment on each new result.

**Performance tiers**
- On load the page picks `tier-full` (2 or more CPU cores and 2 GB or more memory, where the browser reports them) or `tier-lite`.
- If the first second of frames averages over 24 ms, full mode switches to lite.
- Lite mode removes pinning and canvas loops, and shows the stages as a normal page. Reveals and the route stay on.
- Reduced motion (`prefers-reduced-motion: reduce`) shows the final state of everything with no movement.
- The device pixel ratio is capped at 1.5 in full mode and 1 in lite mode.

**Testing modes**
- `?tier=full` forces full mode.
- `?tier=lite` forces lite mode.
- `?motion=reduced` forces reduced motion.

**Charts and map**
- Plotly charts use the shared palette and Martian Mono tick labels. Legends toggle traces, and hover labels are on.
- Charts resize on window resize (debounced).
- The Models page charts draw once and update through `Plotly.react`.

**Responsive**
- Desktop: two columns on Predict and Retrain, a grid of charts on Models.
- Tablet and phone: single column. Tables scroll inside their own container. Tap targets are at least 44px.
- The top bar wraps on narrow screens.

**Running locally:** `python run.py`, then open http://127.0.0.1:5000. Use `?tier=lite` or `?motion=reduced` to check the lighter modes.

---

## What's inside (syllabus mapping)

- **Module 2, search**
  - A* over 12 real Mumbai locations and 18 links. Each link's street path and driving length come from the public OSRM router at startup.
  - The heuristic is the Haversine straight-line distance, which never overestimates.
  - Road cost grows with traffic and with the predicted delay risk.
  - With several drop-offs, every visiting order is costed with A* and the cheapest is used.
  - Greedy best-first and breadth-first search are baselines, costed the same way.
- **Module 3, supervised learning**: multiple linear regression for delivery minutes; decision trees (Gini and entropy), random forest and logistic regression for delay risk (late = over 30 minutes).
- **Module 4, unsupervised learning**: K-Means with an elbow curve, and PCA to plot the clusters in 2D.
- **Module 5, evaluation**: confusion matrix, precision, recall, F1, ROC-AUC and 5-fold stratified cross-validation, all on a held-out 20% test split.
- **Module 6, application**: Flask app with live prediction, retraining without a restart, and Plotly charts.

---

## Project layout

```
.
├── dataset/
│   ├── Dataset.csv                  # Kaggle data, 45,584 orders with GPS coordinates
│   ├── food_delivery_times.csv      # 6k orders, optional retraining batch
│   └── food_delivery_orders.csv     # 1.8k orders with a different schema, optional retraining batch
├── src/
│   ├── config.py                    # Paths and constants
│   ├── data_pipeline.py             # Cleaning, Haversine distance, imputation, scaling
│   ├── models.py                    # Regression and classifiers
│   ├── clustering.py                # K-Means and PCA
│   ├── search_planner.py            # Mumbai network, OSRM street paths, A*, Greedy, BFS
│   ├── evaluate.py                  # Metrics and cross-validation
│   └── retrainer.py                 # Train/test split and retraining
├── web/
│   ├── app.py                       # Flask routes
│   ├── templates/                   # Predict, Retrain and Models pages
│   └── static/                      # CSS and JavaScript (Plotly charts, MapLibre map)
├── reports/project_report.md        # Report and viva questions
├── requirements.txt
└── run.py                           # Start the app
```

---

## Results

Held-out 20% test split (9,117 orders); an order counts as delayed when it takes more than 30 minutes.

- **Random forest**: accuracy 90.87%, ROC-AUC 0.966
- **Decision tree (Gini)**: accuracy 90.36%, ROC-AUC 0.934
- **Linear regression**: MAE 4.93 min, RMSE 6.17 min, R squared 0.567
- **5-fold CV (Gini tree, training split)**: 89.43% +/- 0.44
- **A\* from Lower Parel to Powai, medium traffic**: 30.0 km and 85.8 min via Worli and the sea link. Greedy and BFS go through Dadar and Kurla instead: 27.6 km and 102.6 min.

---

## Credits

Map tiles: CARTO. Map data and routing: OpenStreetMap contributors, via OSRM. Map rendering: MapLibre GL. Charts: Plotly.
