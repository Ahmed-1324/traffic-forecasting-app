let comparisonChart = null;
let lineChart = null;

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function showAnalyticsStatus(message, type = "loading") {
    const status = document.getElementById("analyticsStatusMessage");
    if (!status) return;

    status.style.display = "block";
    status.className = "status-box";

    if (type === "success") {
        status.classList.add("status-success");
    } else if (type === "error") {
        status.classList.add("status-error");
    } else {
        status.classList.add("status-loading");
    }

    status.textContent = message;
}

function renderComparisonChart(modelsData, bestModelName) {
    const ctx = document.getElementById("comparisonChart").getContext("2d");

    if (comparisonChart) {
        comparisonChart.destroy();
    }

    const labels = ["MAE", "RMSE", "MAPE", "R²"];
    const modelNames = Object.keys(modelsData);

    comparisonChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: modelNames.map(modelName => {
                const model = modelsData[modelName];
                const isBest = modelName === bestModelName;

                return {
                    label: modelName,
                    data: [
                        model.mae,
                        model.rmse,
                        model.mape,
                        model.r2
                    ],
                    borderWidth: isBest ? 3 : 1,
                    borderRadius: 6
                };
            })
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: "top"
                },
                title: {
                    display: true,
                    text: "XGBoost vs Transformer",
                    font: {
                        size: 16,
                        weight: "bold"
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: "Metric Value"
                    }
                }
            }
        }
    });
}

function renderLineChart(modelsData, bestModelName) {
    const ctx = document.getElementById("lineChart").getContext("2d");

    if (lineChart) {
        lineChart.destroy();
    }

    const labels = ["MAE", "RMSE", "MAPE", "R²"];
    const modelNames = Object.keys(modelsData);

    lineChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: modelNames.map(modelName => {
                const model = modelsData[modelName];
                const isBest = modelName === bestModelName;

                return {
                    label: modelName,
                    data: [
                        model.mae,
                        model.rmse,
                        model.mape,
                        model.r2
                    ],
                    borderWidth: isBest ? 4 : 2,
                    pointRadius: isBest ? 5 : 3,
                    tension: 0.3
                };
            })
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: {
                    position: "top"
                },
                title: {
                    display: true,
                    text: "Metric Trend Comparison",
                    font: {
                        size: 16,
                        weight: "bold"
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: "Metric Value"
                    }
                }
            }
        }
    });
}

function updateMetricCards(bestModelData) {
    setText("mae", bestModelData.mae);
    setText("rmse", bestModelData.rmse);
    setText("mape", `${bestModelData.mape}%`);
    setText("r2", bestModelData.r2);
}

function updateTable(modelsData, bestModelName) {
    const tableBody = document.getElementById("modelTable");
    tableBody.innerHTML = "";

    const modelNames = Object.keys(modelsData);

    modelNames.forEach(modelName => {
        const model = modelsData[modelName];
        const isBest = modelName === bestModelName;

        const row = document.createElement("tr");

        if (isBest) {
            row.classList.add("best-model-row");
        }

        row.innerHTML = `
            <td>
                ${model.model}
                ${isBest ? '<span class="best-badge">Best</span>' : ''}
            </td>
            <td>${model.mae}</td>
            <td>${model.rmse}</td>
            <td>${model.mape}</td>
            <td>${model.r2}</td>
        `;

        tableBody.appendChild(row);
    });
}

async function loadAnalyticsData(mode, sensorId = "") {
    let url = `/analytics-data?mode=${encodeURIComponent(mode)}`;

    if (mode === "sensor" && sensorId) {
        url += `&sensor_id=${encodeURIComponent(sensorId)}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Failed to load analytics data.");
    }

    return data;
}

async function applyAnalytics() {
    const mode = document.getElementById("analyticsMode").value;
    const sensorId = document.getElementById("analyticsSensor").value;

    if (mode === "sensor" && !sensorId) {
        throw new Error("Please select a sensor.");
    }

    const data = await loadAnalyticsData(mode, sensorId);

    const bestModelName = data.best_model.model;
    const bestModelData = data.models[bestModelName];

    renderComparisonChart(data.models, bestModelName);
    renderLineChart(data.models, bestModelName);
    updateTable(data.models, bestModelName);
    updateMetricCards(bestModelData);

    setText("bestModelName", data.best_model.model);
    setText("bestModelText", data.best_model.summary);
}

document.addEventListener("DOMContentLoaded", async () => {
    const modeSelect = document.getElementById("analyticsMode");
    const sensorSelect = document.getElementById("analyticsSensor");
    const applyBtn = document.getElementById("applyAnalyticsBtn");

    modeSelect.addEventListener("change", () => {
        if (modeSelect.value === "sensor") {
            sensorSelect.disabled = false;
        } else {
            sensorSelect.disabled = true;
            sensorSelect.value = "";
        }
    });

    applyBtn.addEventListener("click", async () => {
        applyBtn.disabled = true;
        applyBtn.textContent = "Loading...";

        showAnalyticsStatus("Loading analytics...", "loading");

        try {
            await applyAnalytics();
            showAnalyticsStatus("Analytics updated successfully.", "success");
        } catch (error) {
            console.error(error);
            showAnalyticsStatus(error.message, "error");
        } finally {
            applyBtn.disabled = false;
            applyBtn.textContent = "APPLY ANALYSIS";
        }
    });
});