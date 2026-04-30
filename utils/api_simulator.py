def get_api_data(sensor_df, selected_timestamp):
    """
    Temporary API simulator.
    For now, it returns the last 12 historical speeds before the selected time.
    Later, we replace this with real API data.
    """
    last_12 = sensor_df.loc[:selected_timestamp]["speed"].values[-12:]
    return last_12