let predictionChart = null;
let errorChart = null;
let map = null;
let marker = null;
let allSensorLayer = null;


function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function getSelectedValues() {
    return {
        date: document.getElementById("date").value,
        time: document.getElementById("time").value,
        sensor: document.getElementById("sensor").value,
        model: document.getElementById("model").value,
        horizon: document.getElementById("horizon").value
    };
}

function showError(message) {
    const status = document.getElementById("statusMessage");
    if (!status) return;

    status.style.display = "block";
    status.className = "status-box status-error";
    status.textContent = message;
}

function showSuccess(message) {
    const status = document.getElementById("statusMessage");
    if (!status) return;

    status.style.display = "block";
    status.className = "status-box status-success";
    status.textContent = message;
}

function showLoading(message) {
    const status = document.getElementById("statusMessage");
    if (!status) return;

    status.style.display = "block";
    status.className = "status-box status-loading";
    status.textContent = message;
}

function updateCongestionBadge(level) {
    const congestionEl = document.getElementById("congestion");
    if (!congestionEl) return;

    congestionEl.textContent = level;
    congestionEl.className = "congestion-badge";

    if (level.includes("Low")) {
        congestionEl.classList.add("congestion-low");
    } else if (level.includes("Moderate")) {
        congestionEl.classList.add("congestion-moderate");
    } else if (level.includes("High")) {
        congestionEl.classList.add("congestion-high");
    } else {
        congestionEl.classList.add("congestion-severe");
    }
}

 
   async function uploadDataset() {
    const fileInput = document.getElementById("datasetFile");

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        throw new Error("Please choose a CSV file first.");
    }

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    const response = await fetch("/upload-dataset", {
        method: "POST",
        body: formData
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Dataset upload failed.");
    }

    // Update sensor dropdown using uploaded dataset sensors
    const sensorSelect = document.getElementById("sensor");

    if (sensorSelect && data.sensors) {
        sensorSelect.innerHTML = "";

        data.sensors.forEach(sensor => {
            const option = document.createElement("option");
            option.value = sensor;
            option.textContent = sensor;
            sensorSelect.appendChild(option);
        });
    }


    const dateInput = document.getElementById("date");

    if (dateInput && data.min_date && data.max_date) {
        dateInput.min = data.min_date;
        dateInput.max = data.max_date;
        dateInput.value = data.min_date;

        await loadValidTimes(data.min_date);
    }

    // Automatically select Uploaded model
   
   showSuccess("Dataset uploaded successfully. Choose a sensor, then apply forecast to show it on the map.");
   
}

async function loadValidTimes(selectedDate) {
    const timeSelect = document.getElementById("time");
    const sensorSelect = document.getElementById("sensor");

    timeSelect.innerHTML = "";

    if (!selectedDate) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Select date first";
        timeSelect.appendChild(option);
        return;
    }

    if (!sensorSelect || !sensorSelect.value) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Select sensor first";
        timeSelect.appendChild(option);
        return;
    }

    const sensor = sensorSelect.value;

    try {
        const response = await fetch(
            `/get-uploaded-valid-times?date=${encodeURIComponent(selectedDate)}&sensor=${encodeURIComponent(sensor)}`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to load valid times.");
        }

        if (!data.times || data.times.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No valid times";
            timeSelect.appendChild(option);
            return;
        }

        data.times.forEach((timeValue, index) => {
            const option = document.createElement("option");
            option.value = timeValue;
            option.textContent = timeValue;

            if (index === 0) {
                option.selected = true;
            }

            timeSelect.appendChild(option);
        });

    } catch (error) {
        showError(error.message);
    }
}

function renderPredictionChart(labels, predictedValues, actualValues, hasActualFuture) {
    const ctx = document.getElementById("predictionChart").getContext("2d");

    if (predictionChart) {
        predictionChart.destroy();
    }

    const datasets = [
        {
            label: "Predicted Traffic",
            data: predictedValues,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.35,
            fill: false
        }
    ];

    if (hasActualFuture && actualValues && actualValues.length > 0) {
        datasets.push({
            label: "Actual Traffic",
            data: actualValues,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.35,
            fill: false
        });
    }

    predictionChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels.map(label => label.slice(11)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: hasActualFuture
                        ? "Predicted vs Actual Traffic"
                        : "Future Traffic Forecast",
                    font: {
                        size: 16,
                        weight: "bold"
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: "Time"
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: "Traffic Volume"
                    }
                }
            }
        }
    });
}
function renderErrorChart(labels, errorValues) {
    const ctx = document.getElementById("errorChart").getContext("2d");

    if (errorChart) {
        errorChart.destroy();
    }

    errorChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels.map(label => label.slice(11)),
            datasets: [
                {
                    label: "Prediction Error",
                    data: errorValues,
                    borderWidth: 1,
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: {
                        boxWidth: 14,
                        padding: 15,
                        font: {
                            size: 12,
                            weight: "bold"
                        }
                    }
                },
                title: {
                    display: true,
                    text: "Error Over Time",
                    font: {
                        size: 16,
                        weight: "bold"
                    },
                    padding: {
                        top: 10,
                        bottom: 20
                    }
                },
                tooltip: {
                    backgroundColor: "rgba(0,0,0,0.8)",
                    padding: 10,
                    cornerRadius: 6
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 6,
                        font: {
                            size: 11
                        }
                    },
                    title: {
                        display: true,
                        text: "Time",
                        font: {
                            size: 12,
                            weight: "bold"
                        }
                    }
                },
                y: {
                    grid: {
                        color: "rgba(0,0,0,0.08)"
                    },
                    ticks: {
                        font: {
                            size: 11
                        }
                    },
                    title: {
                        display: true,
                        text: "Error",
                        font: {
                            size: 12,
                            weight: "bold"
                        }
                    }
                }
            }
        }
    });
}

function initializeMap() {
    map = L.map("map").setView([34.0522, -118.2437], 10);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    setTimeout(() => {
        map.invalidateSize();
    }, 300);
}


function getSensorColor(congestionLevel) {
    if (congestionLevel.includes("Low")) {
        return "green";
    } else if (congestionLevel.includes("Moderate")) {
        return "#d6b800";
    } else if (congestionLevel.includes("High")) {
        return "orange";
    } else {
        return "red";
    }
}

async function loadAllSensorsOnMap() {
    try {
        const response = await fetch("/uploaded-sensor-map");
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to load sensor map.");
        }

        if (!map) {
            initializeMap();
        }

        if (allSensorLayer) {
            map.removeLayer(allSensorLayer);
        }

        allSensorLayer = L.layerGroup().addTo(map);

        const bounds = [];

        data.sensors.forEach(sensor => {
            const lat = sensor.latitude;
            const lon = sensor.longitude;

            const color = getSensorColor(sensor.congestion_level);

            const circle = L.circleMarker([lat, lon], {
                radius: 7,
                color: color,
                fillColor: color,
                fillOpacity: 0.75,
                weight: 2
            }).addTo(allSensorLayer);

            circle.bindPopup(`
                <div style="min-width: 200px; line-height: 1.7;">
                    <div><strong>Sensor ID:</strong> ${sensor.sensor_id}</div>
                    <div><strong>Latest Value:</strong> ${sensor.latest_speed}</div>
                    <div><strong>Average Value:</strong> ${sensor.avg_speed}</div>
                    <div><strong>Traffic Level:</strong> ${sensor.congestion_level}</div>
                </div>
            `);

            bounds.push([lat, lon]);
        });

        if (bounds.length > 0) {
            map.fitBounds(bounds, {
                padding: [30, 30]
            });
        }

    } catch (error) {
        showError(error.message);
    }
}

function updateMap(lat, lon, sensorId, congestionLevel, predictedAvgSpeed) {
    if (lat === null || lon === null || lat === undefined || lon === undefined) {
        return;
    }

    if (!map) {
        initializeMap();
    }

    if (marker) {
        map.removeLayer(marker);
    }

    map.setView([lat, lon], 13);

   const color = getSensorColor(congestionLevel);

    marker = L.circleMarker([lat, lon], {
        radius: 12,
        color: "#000",          // black border
        fillColor: color,       // congestion color
        fillOpacity: 0.9,
        weight: 3
    }).addTo(map);

    let congestionColor = "green";
    if (congestionLevel.includes("Moderate")) congestionColor = "#8d6e00";
    else if (congestionLevel.includes("High")) congestionColor = "#e65100";
    else if (congestionLevel.includes("Severe")) congestionColor = "#b71c1c";

    const popupContent = `
        <div style="min-width: 190px; line-height: 1.7;">
            <div><strong>Sensor ID:</strong> ${sensorId}</div>
            <div>
                <strong>Congestion:</strong>
                <span style="color:${congestionColor}; font-weight:bold;">
                    ${congestionLevel}
                </span>
            </div>
            <div><strong>Predicted Avg Speed:</strong> ${predictedAvgSpeed}</div>
        </div>
    `;

    marker.bindPopup(popupContent).openPopup();

    setTimeout(() => {
        map.invalidateSize();
    }, 300);
}

function updateCardsAndTable(data) {
    setText("sensor_id", data.sensor_id);
    setText("current_speed", `${data.current_speed}`);
    setText("pred_avg", `${data.predicted_avg_speed}`);
    setText("prediction_mode", data.prediction_mode || "--");
    setText("congestion_method", data.congestion_method || "--");

    updateCongestionBadge(data.congestion_level);

    setText("table_date", data.table.date);
    setText("table_time", data.table.time);
    setText("table_sensor", data.table.sensor);
    setText("table_model", data.table.model);
}

async function runPrediction() {
    const payload = getSelectedValues();

    if (!payload.date || !payload.time || !payload.sensor || !payload.model || !payload.horizon) {
        throw new Error("Please fill in all fields first.");
    }

    const response = await fetch("/predict", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Prediction failed.");
    }

    updateCardsAndTable(data);
    

    renderPredictionChart(
        data.future_timestamps,
        data.predicted_values,
        data.actual_values,
        data.has_actual_future
    );

    const errorChartTitle = document.getElementById("errorChartTitle");

    if (data.has_actual_future && data.error_values.length > 0) {
        if (errorChartTitle) {
            errorChartTitle.textContent = "Error Over Time";
        }

        renderErrorChart(data.future_timestamps, data.error_values);

    } else {
        if (errorChartTitle) {
            errorChartTitle.textContent = "Error Over Time — Not Available in Forecast Mode";
        }

        if (errorChart) {
            errorChart.destroy();
            errorChart = null;
        }

        const ctx = document.getElementById("errorChart").getContext("2d");
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    
    
    
    
    
    updateMap(
        data.latitude,
        data.longitude,
        data.sensor_id,
        data.congestion_level,
        data.predicted_avg_speed
    );
}


async function loadEnabledModelsForDashboard() {
    const modelSelect = document.getElementById("model");

    if (!modelSelect) return;

    const response = await fetch("/enabled-models");
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Failed to load enabled models.");
    }

    modelSelect.innerHTML = "";

    Object.entries(data.enabled_models).forEach(([modelName, isEnabled]) => {
        if (isEnabled) {
            const option = document.createElement("option");
            option.value = modelName;
            option.textContent = modelName;
            modelSelect.appendChild(option);
        }
    });

    if (modelSelect.options.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No enabled models";
        modelSelect.appendChild(option);
    }
}



async function restoreUploadedDatasetState() {
    const response = await fetch("/uploaded-dataset-state");
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Failed to restore uploaded dataset state.");
    }

    if (!data.uploaded) {
        return;
    }

    const sensorSelect = document.getElementById("sensor");

    if (sensorSelect && data.sensors) {
        sensorSelect.innerHTML = "";

        data.sensors.forEach(sensor => {
            const option = document.createElement("option");
            option.value = sensor;
            option.textContent = sensor;
            sensorSelect.appendChild(option);
        });
    }

    const dateInput = document.getElementById("date");

    if (dateInput && data.min_date && data.max_date) {
        dateInput.min = data.min_date;
        dateInput.max = data.max_date;
        dateInput.value = data.min_date;

        await loadValidTimes(data.min_date);
    }

    showSuccess("Previously uploaded dataset restored.");
}




document.addEventListener("DOMContentLoaded", async () => {
    const dateInput = document.getElementById("date");
    const predictBtn = document.getElementById("predictBtn");
    const uploadBtn = document.getElementById("uploadBtn");
    const sensorSelect = document.getElementById("sensor");

    const datasetFile = document.getElementById("datasetFile");
    const fileName = document.getElementById("fileName");

    if (datasetFile && fileName) {
        datasetFile.addEventListener("change", () => {
            if (datasetFile.files.length > 0) {
                fileName.textContent = datasetFile.files[0].name;
            } else {
                fileName.textContent = "Choose CSV Dataset";
            }
        });
    }

    

    initializeMap();
    await loadEnabledModelsForDashboard();
    await restoreUploadedDatasetState();

    if (sensorSelect) {
        sensorSelect.addEventListener("change", async () => {
            if (dateInput && dateInput.value) {
                await loadValidTimes(dateInput.value);
            }
        });
    }

    
    // rest of your code continues here...


   // if (dateInput) {
      //  dateInput.addEventListener("change", async () => {
       //     await loadValidTimes(dateInput.value);
      //  });

      //  if (dateInput.value) {
      //      await loadValidTimes(dateInput.value);
       // } else {
        //    const firstValidDate = dateInput.min || "";
         //   if (firstValidDate) {
          //      dateInput.value = firstValidDate;
         //       await loadValidTimes(dateInput.value);
      //      }
     //   }
//    }

    if (uploadBtn) {
        uploadBtn.addEventListener("click", async () => {
            uploadBtn.disabled = true;
            uploadBtn.textContent = "Uploading...";

            showLoading("Uploading dataset ...");

            try {
                await uploadDataset();
            } catch (error) {
                showError(error.message || "Upload failed.");
            } finally {
                uploadBtn.disabled = false;
                uploadBtn.textContent = "UPLOAD DATASET";
            }
        });
    }

    if (predictBtn) {
        predictBtn.addEventListener("click", async () => {
            predictBtn.disabled = true;
            predictBtn.textContent = "Loading...";

            showLoading("Running forecast...");

            try {
                await runPrediction();
                showSuccess("Forecast generated successfully.");
            } catch (error) {
                showError(error.message || "Prediction failed.");
            } finally {
                predictBtn.disabled = false;
                predictBtn.textContent = "APPLY FORECAST";
            }
        });
    }
});