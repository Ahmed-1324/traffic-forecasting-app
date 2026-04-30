import os
import joblib
import numpy as np
import pandas as pd
import tensorflow as tf

from flask import Flask, render_template, request, jsonify, redirect, url_for
from tensorflow.keras.models import load_model
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import MinMaxScaler


app = Flask(__name__)

# =========================================================
# BASE PATHS
# =========================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SENSOR_LOCATIONS_PATH = os.path.join(BASE_DIR, "graph_sensor_locations.csv")

PRETRAINED_XGBOOST_PATH = os.path.join(
    BASE_DIR, "saved_models", "uploaded_xgboost", "pretrained_xgboost.pkl"
)

UPLOADED_TRANSFORMER_PATH = os.path.join(
    BASE_DIR, "saved_models", "uploaded_transformer", "per_sensor_transformer.h5"
)

UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024


# =========================================================
# CONFIG
# =========================================================
INPUT_STEPS = 12
OUTPUT_STEPS = 12
TIME_STEP_MINUTES = 5

SUPPORTED_MODELS = {"XGBoost", "Transformer"}

uploaded_active_df = None
uploaded_supported_sensors = []
uploaded_sensor_thresholds = {}

enabled_models = {
    "XGBoost": True,
    "Transformer": True
}


# =========================================================
# CUSTOM LAYER FOR OLD TRANSFORMER MODELS
# =========================================================
class PositionalEncoding(tf.keras.layers.Layer):
    def __init__(self, sequence_length, d_model, **kwargs):
        super().__init__(**kwargs)
        self.sequence_length = sequence_length
        self.d_model = d_model

    def get_angles(self, positions, i, d_model):
        angle_rates = 1 / np.power(
            10000,
            (2 * (i // 2)) / np.float32(d_model)
        )
        return positions * angle_rates

    def call(self, inputs):
        positions = np.arange(self.sequence_length)[:, np.newaxis]
        i = np.arange(self.d_model)[np.newaxis, :]
        angle_rads = self.get_angles(positions, i, self.d_model)

        angle_rads[:, 0::2] = np.sin(angle_rads[:, 0::2])
        angle_rads[:, 1::2] = np.cos(angle_rads[:, 1::2])

        pos_encoding = tf.cast(angle_rads[np.newaxis, ...], dtype=tf.float32)
        return inputs + pos_encoding

    def get_config(self):
        config = super().get_config()
        config.update({
            "sequence_length": self.sequence_length,
            "d_model": self.d_model
        })
        return config


# =========================================================
# DATA LOADING
# =========================================================
def load_sensor_locations():
    if not os.path.exists(SENSOR_LOCATIONS_PATH):
        return pd.DataFrame(columns=["sensor_id", "latitude", "longitude"])

    locations = pd.read_csv(SENSOR_LOCATIONS_PATH)

    required_cols = {"sensor_id", "latitude", "longitude"}
    missing = required_cols - set(locations.columns)

    if missing:
        return pd.DataFrame(columns=["sensor_id", "latitude", "longitude"])

    locations["sensor_id"] = locations["sensor_id"].astype(str)
    return locations


sensor_locations_df = load_sensor_locations()


# =========================================================
# HELPERS
# =========================================================
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() == "csv"


def format_float_list(values, digits=2):
    return [round(float(v), digits) for v in values]


def validate_uploaded_dataset(file_path):
    try:
        uploaded_df = pd.read_csv(
            file_path,
            encoding="utf-8",
            sep=None,
            engine="python",
            on_bad_lines="skip"
        )
    except UnicodeDecodeError:
        uploaded_df = pd.read_csv(
            file_path,
            encoding="latin1",
            sep=None,
            engine="python",
            on_bad_lines="skip"
        )

    if uploaded_df.empty:
        raise ValueError("Uploaded CSV is empty or could not be read correctly.")

    uploaded_df.columns = uploaded_df.columns.astype(str).str.strip()

    # Long format: timestamp, sensor_id, speed
    if {"timestamp", "sensor_id", "speed"}.issubset(uploaded_df.columns):
        keep_cols = ["timestamp", "sensor_id", "speed"]

        if "latitude" in uploaded_df.columns and "longitude" in uploaded_df.columns:
            keep_cols += ["latitude", "longitude"]

        uploaded_df = uploaded_df[keep_cols].copy()

    # Wide format: first column timestamp, other columns sensors
    else:
        time_col = uploaded_df.columns[0]
        uploaded_df = uploaded_df.rename(columns={time_col: "timestamp"})

        uploaded_df = uploaded_df.melt(
            id_vars=["timestamp"],
            var_name="sensor_id",
            value_name="speed"
        )

    uploaded_df["timestamp"] = pd.to_datetime(
        uploaded_df["timestamp"],
        errors="coerce"
    )

    uploaded_df["sensor_id"] = uploaded_df["sensor_id"].astype(str)
    uploaded_df["speed"] = pd.to_numeric(uploaded_df["speed"], errors="coerce")

    if "latitude" in uploaded_df.columns and "longitude" in uploaded_df.columns:
        uploaded_df["latitude"] = pd.to_numeric(uploaded_df["latitude"], errors="coerce")
        uploaded_df["longitude"] = pd.to_numeric(uploaded_df["longitude"], errors="coerce")

    uploaded_df = uploaded_df.dropna(subset=["timestamp", "speed"])

    if uploaded_df.empty:
        raise ValueError("No valid timestamp/speed rows found in uploaded CSV.")

    uploaded_df = uploaded_df.sort_values(["sensor_id", "timestamp"])
    uploaded_df = uploaded_df.reset_index(drop=True)

    return uploaded_df





def get_dynamic_congestion_level(speed, sensor_id=None):
    """
    Congestion classification for METR-LA speed data.

    Higher speed means less congestion.
    Lower speed means more congestion.
    """

    speed = float(speed)

    if speed >= 60:
        return "Low Traffic"
    elif speed >= 40:
        return "Moderate Traffic"
    elif speed >= 20:
        return "High Traffic"
    else:
        return "Severe Congestion"





def build_uploaded_features(last_12):
    df_feat = last_12.copy()

    df_feat["hour"] = df_feat["timestamp"].dt.hour
    df_feat["day"] = df_feat["timestamp"].dt.dayofweek

    df_feat["hour_sin"] = np.sin(2 * np.pi * df_feat["hour"] / 24)
    df_feat["hour_cos"] = np.cos(2 * np.pi * df_feat["hour"] / 24)

    df_feat["day_sin"] = np.sin(2 * np.pi * df_feat["day"] / 7)
    df_feat["day_cos"] = np.cos(2 * np.pi * df_feat["day"] / 7)

    scaler = MinMaxScaler()
    df_feat["speed_scaled"] = scaler.fit_transform(df_feat[["speed"]])

    features = df_feat[
        ["speed_scaled", "hour_sin", "hour_cos", "day_sin", "day_cos"]
    ].values.astype(float)

    return features, scaler


def load_prediction_model(model_name):
    if model_name == "XGBoost":
        if not os.path.exists(PRETRAINED_XGBOOST_PATH):
            raise FileNotFoundError("Pretrained XGBoost model file was not found.")
        return joblib.load(PRETRAINED_XGBOOST_PATH)

    if model_name == "Transformer":
        if not os.path.exists(UPLOADED_TRANSFORMER_PATH):
            raise FileNotFoundError("Pretrained Transformer model file was not found.")
        return load_model(
            UPLOADED_TRANSFORMER_PATH,
            custom_objects={"PositionalEncoding": PositionalEncoding},
            compile=False
        )

    raise ValueError("Unsupported model.")


def predict_uploaded_window(model_name, model, last_12):
    features, scaler = build_uploaded_features(last_12)

    if model_name == "XGBoost":
        x_input = features.flatten().reshape(1, -1)
        predicted_scaled = model.predict(x_input).flatten()

    elif model_name == "Transformer":
        x_input = features.reshape(1, INPUT_STEPS, 5)
        predicted_scaled = model.predict(x_input, verbose=0).flatten()

    else:
        raise ValueError("Unsupported model.")

    predicted = scaler.inverse_transform(
        predicted_scaled.reshape(-1, 1)
    ).flatten()

    return predicted


def evaluate_uploaded_dataset(model_name, sensor_id=None, max_windows_per_sensor=10):
    if uploaded_active_df is None:
        raise ValueError("Please upload a dataset first.")

    model = load_prediction_model(model_name)

    if sensor_id:
        sensors = [str(sensor_id)]
    else:
        sensors = uploaded_active_df["sensor_id"].astype(str).unique().tolist()

    all_actual = []
    all_predicted = []

    evaluated_sensors = 0
    evaluated_windows = 0

    for sid in sensors:
        sensor_df = uploaded_active_df[
            uploaded_active_df["sensor_id"].astype(str) == str(sid)
        ].copy()

        sensor_df = sensor_df.sort_values("timestamp").reset_index(drop=True)

        if len(sensor_df) < INPUT_STEPS + OUTPUT_STEPS:
            continue

        valid_positions = list(range(INPUT_STEPS, len(sensor_df) - OUTPUT_STEPS))

        if len(valid_positions) > max_windows_per_sensor:
            sample_indices = np.linspace(
                0,
                len(valid_positions) - 1,
                max_windows_per_sensor,
                dtype=int
            )
            valid_positions = [valid_positions[i] for i in sample_indices]

        sensor_used = False

        for pos in valid_positions:
            last_12 = sensor_df.iloc[pos - INPUT_STEPS:pos].copy()
            actual_future = sensor_df.iloc[pos:pos + OUTPUT_STEPS]["speed"].values.astype(float)

            predicted_future = predict_uploaded_window(model_name, model, last_12)

            all_actual.extend(actual_future)
            all_predicted.extend(predicted_future)

            evaluated_windows += 1
            sensor_used = True

        if sensor_used:
            evaluated_sensors += 1

    if len(all_actual) == 0:
        raise ValueError("No valid evaluation windows found in uploaded dataset.")

    all_actual = np.array(all_actual)
    all_predicted = np.array(all_predicted)

    mae = mean_absolute_error(all_actual, all_predicted)
    rmse = np.sqrt(mean_squared_error(all_actual, all_predicted))
    mape = np.mean(np.abs((all_actual - all_predicted) / (all_actual + 1e-8))) * 100
    r2 = r2_score(all_actual, all_predicted)

    return {
        "model": model_name,
        "mae": round(float(mae), 4),
        "rmse": round(float(rmse), 4),
        "mape": round(float(mape), 4),
        "r2": round(float(r2), 4),
        "num_sensors": int(evaluated_sensors),
        "num_windows": int(evaluated_windows)
    }


# =========================================================
# PAGES
# =========================================================
@app.route("/")
def home():
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def handle_login():
    return redirect(url_for("dashboard"))


@app.route("/dashboard")
def dashboard():
    return render_template(
        "dashboard.html",
        supported_sensors=[],
        min_date="",
        max_date=""
    )


@app.route("/analytics")
def analytics():
    return render_template(
        "analytics.html",
        supported_sensors=uploaded_supported_sensors
    )


@app.route("/models")
def models_page():
    return render_template("models.html")


# =========================================================
# API ROUTES
# =========================================================
@app.route("/upload-dataset", methods=["POST"])
def upload_dataset():
    global uploaded_active_df, uploaded_supported_sensors, uploaded_sensor_thresholds

    try:
        if "file" not in request.files:
            return jsonify({"error": "No file part"}), 400

        file = request.files["file"]

        if file.filename == "":
            return jsonify({"error": "No selected file"}), 400

        if not allowed_file(file.filename):
            return jsonify({"error": "Only CSV files are allowed"}), 400

        file_path = os.path.join(app.config["UPLOAD_FOLDER"], file.filename)
        file.save(file_path)

        uploaded_df = validate_uploaded_dataset(file_path)

        uploaded_active_df = uploaded_df
        uploaded_supported_sensors = sorted(
            uploaded_df["sensor_id"].astype(str).unique().tolist()
        )
       

        min_date = uploaded_df["timestamp"].min().strftime("%Y-%m-%d")
        max_date = uploaded_df["timestamp"].max().strftime("%Y-%m-%d")

        return jsonify({
            "message": "File uploaded successfully",
            "file_path": file.filename,
            "rows": int(uploaded_df.shape[0]),
            "columns": list(uploaded_df.columns),
            "sensors": uploaded_supported_sensors,
            "min_date": min_date,
            "max_date": max_date,
            "thresholds_created": len(uploaded_sensor_thresholds),
            "metrics": None
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/uploaded-dataset-state", methods=["GET"])
def uploaded_dataset_state():
    try:
        if uploaded_active_df is None:
            return jsonify({"uploaded": False})

        min_date = uploaded_active_df["timestamp"].min().strftime("%Y-%m-%d")
        max_date = uploaded_active_df["timestamp"].max().strftime("%Y-%m-%d")

        return jsonify({
            "uploaded": True,
            "rows": int(uploaded_active_df.shape[0]),
            "columns": list(uploaded_active_df.columns),
            "sensors": uploaded_supported_sensors,
            "min_date": min_date,
            "max_date": max_date
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/get-uploaded-valid-times", methods=["GET"])
def get_uploaded_valid_times():
    try:
        if uploaded_active_df is None:
            raise ValueError("No uploaded dataset found.")

        date_str = request.args.get("date", "").strip()
        sensor_id = request.args.get("sensor", "").strip()

        if not date_str:
            raise ValueError("Date is required.")

        if not sensor_id:
            raise ValueError("Sensor is required.")

        selected_date = pd.to_datetime(date_str).date()

        sensor_df = uploaded_active_df[
            uploaded_active_df["sensor_id"].astype(str) == str(sensor_id)
        ].copy()

        sensor_df = sensor_df.sort_values("timestamp").reset_index(drop=True)

        valid_times = []

        for i in range(len(sensor_df)):
            ts = sensor_df.loc[i, "timestamp"]

            if ts.date() != selected_date:
                continue

            if i - INPUT_STEPS >= 0:
                valid_times.append(ts.strftime("%H:%M"))

        return jsonify({"times": valid_times})

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/uploaded-sensor-map", methods=["GET"])
def uploaded_sensor_map():
    try:
        if uploaded_active_df is None:
            raise ValueError("Upload dataset first.")

        if "latitude" not in uploaded_active_df.columns or "longitude" not in uploaded_active_df.columns:
            raise ValueError("Uploaded dataset does not contain latitude/longitude columns.")

        sensor_points = []

        for sensor_id, sensor_df in uploaded_active_df.groupby("sensor_id"):
            sensor_df = sensor_df.dropna(subset=["latitude", "longitude", "speed"])

            if sensor_df.empty:
                continue

            latest_row = sensor_df.sort_values("timestamp").iloc[-1]
            avg_speed = float(sensor_df["speed"].tail(INPUT_STEPS).mean())
            congestion_level = get_dynamic_congestion_level(avg_speed, sensor_id)

            sensor_points.append({
                "sensor_id": str(sensor_id),
                "latitude": float(latest_row["latitude"]),
                "longitude": float(latest_row["longitude"]),
                "latest_speed": round(float(latest_row["speed"]), 2),
                "avg_speed": round(avg_speed, 2),
                "congestion_level": congestion_level
            })

        return jsonify({
            "sensors": sensor_points,
            "count": len(sensor_points)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/enabled-models", methods=["GET"])
def get_enabled_models():
    return jsonify({"enabled_models": enabled_models})


@app.route("/toggle-model", methods=["POST"])
def toggle_model():
    try:
        data = request.get_json()
        model_name = str(data.get("model", "")).strip()

        if model_name not in enabled_models:
            return jsonify({"error": "Invalid model name."}), 400

        currently_enabled = enabled_models[model_name]

        if currently_enabled:
            active_count = sum(1 for value in enabled_models.values() if value)

            if active_count <= 1:
                return jsonify({
                    "error": "At least one model must remain enabled."
                }), 400

        enabled_models[model_name] = not currently_enabled

        return jsonify({
            "message": f"{model_name} is now {'enabled' if enabled_models[model_name] else 'disabled'}.",
            "enabled_models": enabled_models
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/analytics-data", methods=["GET"])
def analytics_data():
    try:
        if uploaded_active_df is None:
            return jsonify({
                "error": "Please upload a dataset from the Dashboard first before using Analytics."
            }), 400

        active_models = [
            name for name, enabled in enabled_models.items()
            if enabled
        ]

        if not active_models:
            return jsonify({"error": "No models are currently enabled."}), 400

        mode = request.args.get("mode", "all")
        sensor_id = request.args.get("sensor_id")

        model_summaries = []

        if mode == "all":
            for model_name in active_models:
                model_summaries.append(evaluate_uploaded_dataset(model_name))

        elif mode == "sensor":
            if not sensor_id:
                return jsonify({"error": "Sensor ID is required for sensor mode."}), 400

            for model_name in active_models:
                model_summaries.append(
                    evaluate_uploaded_dataset(model_name, sensor_id=sensor_id)
                )

        else:
            return jsonify({"error": "Invalid mode"}), 400

        best = sorted(
            model_summaries,
            key=lambda x: (x["mae"], x["rmse"], x["mape"], -x["r2"])
        )[0]

        return jsonify({
            "mode": mode,
            "evaluation_source": "Uploaded Dataset",
            "models": {
                model["model"]: model for model in model_summaries
            },
            "best_model": {
                "model": best["model"],
                "summary": (
                    f"{best['model']} performs best on the currently uploaded dataset "
                    f"based on MAE, RMSE, MAPE, and R²."
                )
            }
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json()

        sensor_id = str(data.get("sensor", "")).strip()
        date_str = str(data.get("date", "")).strip()
        time_str = str(data.get("time", "")).strip()
        model_name = str(data.get("model", "")).strip()
        horizon = str(data.get("horizon", "")).strip()

        if model_name not in SUPPORTED_MODELS:
            raise ValueError("Invalid model selected.")

        if not enabled_models.get(model_name, False):
            raise ValueError(f"{model_name} is currently disabled from the Models page.")

        if horizon != "1 Hour":
            raise ValueError("Only 1 Hour forecast is supported.")

        if uploaded_active_df is None:
            raise ValueError("Upload dataset first.")

        uploaded_sensor_df = uploaded_active_df[
            uploaded_active_df["sensor_id"].astype(str) == str(sensor_id)
        ].copy()

        if uploaded_sensor_df.empty:
            raise ValueError("Sensor not found.")

        uploaded_sensor_df = uploaded_sensor_df.sort_values("timestamp").reset_index(drop=True)

        selected_timestamp = pd.to_datetime(f"{date_str} {time_str}")

        if selected_timestamp not in uploaded_sensor_df["timestamp"].values:
            raise ValueError("Timestamp not found.")

        selected_pos = uploaded_sensor_df.index[
            uploaded_sensor_df["timestamp"] == selected_timestamp
        ][0]

        input_start = selected_pos - INPUT_STEPS

        if input_start < 0:
            raise ValueError("Not enough past data.")

        last_12 = uploaded_sensor_df.iloc[input_start:selected_pos].copy()

        output_start = selected_pos
        output_end = selected_pos + OUTPUT_STEPS

        selected_date_only = selected_timestamp.date()

        same_day_df = uploaded_sensor_df[
            uploaded_sensor_df["timestamp"].dt.date == selected_date_only
        ]

        last_timestamp_for_selected_date = same_day_df["timestamp"].max()
        is_last_time_for_selected_date = selected_timestamp == last_timestamp_for_selected_date

        if output_end <= len(uploaded_sensor_df) and not is_last_time_for_selected_date:
            actual_future = uploaded_sensor_df.iloc[output_start:output_end]["speed"].values
            future_timestamps = uploaded_sensor_df.iloc[output_start:output_end]["timestamp"]
            has_actual_future = True
        else:
            actual_future = None
            future_timestamps = pd.date_range(
                start=selected_timestamp + pd.Timedelta(minutes=TIME_STEP_MINUTES),
                periods=OUTPUT_STEPS,
                freq=f"{TIME_STEP_MINUTES}min"
            )
            has_actual_future = False

        model = load_prediction_model(model_name)
        predicted_future = predict_uploaded_window(model_name, model, last_12)

        current_speed = float(last_12["speed"].iloc[-1])
        rolling_mean_speed = float(last_12["speed"].mean())

        if has_actual_future:
            prediction_mode = "Evaluation Mode"

            error_values = actual_future - predicted_future
            actual_values_output = format_float_list(actual_future)
            error_values_output = format_float_list(error_values)

            mape = float(
                np.mean(
                    np.abs((actual_future - predicted_future) / (actual_future + 1e-8))
                ) * 100
            )

            confidence_score = max(0.0, min(100.0, 100.0 - mape))

        else:
            prediction_mode = "Forecast Mode"
            actual_values_output = []
            error_values_output = []
            confidence_score = None

        predicted_avg_speed = float(np.mean(predicted_future))
        congestion_level = get_dynamic_congestion_level(predicted_avg_speed, sensor_id)

        latitude = None
        longitude = None

        if "latitude" in uploaded_sensor_df.columns and "longitude" in uploaded_sensor_df.columns:
            location_row = uploaded_sensor_df.dropna(subset=["latitude", "longitude"])

            if not location_row.empty:
                latitude = float(location_row.iloc[0]["latitude"])
                longitude = float(location_row.iloc[0]["longitude"])

        return jsonify({
            "sensor_id": sensor_id,
            "model": model_name,
            "data_source": "Uploaded Dataset",
            "selected_datetime": selected_timestamp.strftime("%Y-%m-%d %H:%M"),
            "forecast_horizon": "1 Hour",
            "future_timestamps": [
                pd.to_datetime(ts).strftime("%Y-%m-%d %H:%M")
                for ts in future_timestamps
            ],
            "predicted_values": format_float_list(predicted_future),
            "actual_values": actual_values_output,
            "error_values": error_values_output,
            "has_actual_future": has_actual_future,
            "prediction_mode": prediction_mode,
            "current_speed": round(current_speed, 2),
            "rolling_mean_speed": round(rolling_mean_speed, 2),
            "predicted_avg_speed": round(predicted_avg_speed, 2),
            "congestion_level": congestion_level,
            "congestion_method": "Speed-Based Thresholds",
            "confidence_score": round(confidence_score, 2) if confidence_score is not None else None,
            "latitude": latitude,
            "longitude": longitude,
            "table": {
                "date": selected_timestamp.strftime("%Y-%m-%d"),
                "time": selected_timestamp.strftime("%H:%M"),
                "sensor": sensor_id,
                "horizon": "1 Hour",
                "model": model_name
            }
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 400


# =========================================================
# RUN LOCAL ONLY
# =========================================================
if __name__ == "__main__":
    app.run(debug=True)