import numpy as np
import pandas as pd


def prepare_global_xgboost_input(last_12_values, timestamp, sensor_id):
    timestamp = pd.to_datetime(timestamp)

    hour = timestamp.hour
    day = timestamp.dayofweek

    hour_sin = np.sin(2 * np.pi * hour / 24)
    hour_cos = np.cos(2 * np.pi * hour / 24)

    day_sin = np.sin(2 * np.pi * day / 7)
    day_cos = np.cos(2 * np.pi * day / 7)

    features = np.concatenate([
        np.array(last_12_values),
        [hour_sin, hour_cos, day_sin, day_cos],
        [sensor_id]
    ])

    return features.reshape(1, -1)