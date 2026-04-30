const models = [
    {
        name: "XGBoost",
        type: "Machine Learning",
        typeKey: "machine-learning",
        status: "Active",
        statusKey: "active",
        role: "Pre-trained ML Forecasting Model",
        description: "Fast pre-trained multi-output regression model for 1-hour traffic forecasting.",
        performanceBadge: "Production",
        inputShape: "(1, 60)",
        outputShape: "12 steps",
        features: "speed_scaled, hour_sin, hour_cos, day_sin, day_cos",
        trainingMode: "Offline",
        production: true,
        enabled: true
    },
    {
        name: "Transformer",
        type: "Deep Learning",
        typeKey: "deep-learning",
        status: "Active",
        statusKey: "active",
        role: "Pre-trained Deep Learning Forecasting Model",
        description: "Attention-based pre-trained model for sequence forecasting using 12 previous time steps.",
        performanceBadge: "Candidate",
        inputShape: "(1, 12, 5)",
        outputShape: "12 steps",
        features: "speed_scaled, hour_sin, hour_cos, day_sin, day_cos",
        trainingMode: "Offline",
        production: false,
        enabled: true
    }
];

let selectedModel = models[0];

function showModelsStatus(message, type = "success") {
    const status = document.getElementById("modelsStatusMessage");
    if (!status) return;

    status.style.display = "block";
    status.className = "status-box";

    if (type === "error") {
        status.classList.add("status-error");
    } else if (type === "loading") {
        status.classList.add("status-loading");
    } else {
        status.classList.add("status-success");
    }

    status.textContent = message;
}

function getPerformanceBadgeClass(label) {
    if (label === "Production") return "performance-best";
    if (label === "Candidate") return "performance-competitive";
    return "performance-candidate";
}

async function loadEnabledModelsState() {
    const response = await fetch("/enabled-models");
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Failed to load model state.");
    }

    models.forEach(model => {
        model.enabled = data.enabled_models[model.name];
        model.status = model.enabled ? "Active" : "Disabled";
        model.statusKey = model.enabled ? "active" : "disabled";
    });
}

async function toggleModel(modelName) {
    const response = await fetch("/toggle-model", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: modelName
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Failed to toggle model.");
    }

    await loadEnabledModelsState();

    selectedModel = models.find(model => model.name === modelName) || models[0];

    renderModelList(getFilteredModels());
    renderModelsTable(getFilteredModels());
    updateSelectedModel(selectedModel);

    showModelsStatus(data.message, "success");
}

function renderModelList(filteredModels = models) {
    const modelList = document.getElementById("modelList");
    modelList.innerHTML = "";

    filteredModels.forEach(model => {
        const item = document.createElement("div");

        item.className = "model-list-item";

        if (model.name === selectedModel.name) {
            item.classList.add("selected-model-item");
        }

        if (model.production) {
            item.classList.add("production-model-item");
        }

        item.innerHTML = `
            <div>
                <div class="model-title-row">
                    <h4>${model.name}</h4>

                    ${model.production ? '<span class="production-badge">Production</span>' : ''}

                    <span class="performance-badge ${getPerformanceBadgeClass(model.performanceBadge)}">
                        ${model.performanceBadge}
                    </span>
                </div>

                <p>${model.description}</p>
                <small>Input: ${model.inputShape} | Output: ${model.outputShape}</small>
            </div>

            <span class="status-badge ${model.enabled ? 'status-active' : 'status-retired'}">
                ${model.enabled ? 'Enabled' : 'Disabled'}
            </span>
        `;

        item.addEventListener("click", () => {
            selectedModel = model;
            updateSelectedModel(model);
            renderModelList(getFilteredModels());
            renderModelsTable(getFilteredModels());
        });

        modelList.appendChild(item);
    });

    if (filteredModels.length === 0) {
        modelList.innerHTML = `<p class="empty-message">No models match the selected filters.</p>`;
    }
}

function updateSelectedModel(model) {
    document.getElementById("selectedModelName").textContent = model.name;
    document.getElementById("selectedModelType").textContent = model.type;
    document.getElementById("selectedModelStatus").textContent = model.enabled ? "Enabled" : "Disabled";
    document.getElementById("selectedModelRole").textContent = model.role;
    document.getElementById("selectedModelInput").textContent = model.inputShape;
    document.getElementById("selectedModelOutput").textContent = model.outputShape;
    document.getElementById("selectedModelFeatures").textContent = model.features;
    document.getElementById("selectedModelMetrics").textContent = "Calculated dynamically in Analytics";

    const toggleBtn = document.getElementById("toggleModelBtn");

    if (toggleBtn) {
        toggleBtn.textContent = model.enabled ? "DISABLE MODEL" : "ENABLE MODEL";
    }
}

function renderModelsTable(filteredModels = models) {
    const tableBody = document.getElementById("modelsTableBody");
    tableBody.innerHTML = "";

    filteredModels.forEach(model => {
        const row = document.createElement("tr");

        if (model.production) {
            row.classList.add("best-model-row");
        }

        row.innerHTML = `
            <td>
                ${model.name}
                ${model.production ? '<span class="best-badge">Production</span>' : ''}
            </td>
            <td>${model.type}</td>
            <td>
                <span class="status-badge ${model.enabled ? 'status-active' : 'status-retired'}">
                    ${model.enabled ? 'Enabled' : 'Disabled'}
                </span>
            </td>
            <td>${model.role}</td>
            <td>${model.inputShape}</td>
            <td>${model.outputShape}</td>
            <td>${model.trainingMode}</td>
        `;

        tableBody.appendChild(row);
    });
}

function getFilteredModels() {
    const statusValue = document.getElementById("statusFilter").value;
    const typeValue = document.getElementById("typeFilter").value;

    return models.filter(model => {
        const statusMatch =
            statusValue === "all" ||
            (statusValue === "active" && model.enabled);

        const typeMatch =
            typeValue === "all" ||
            model.typeKey === typeValue;

        return statusMatch && typeMatch;
    });
}

function applyFilters() {
    const filtered = getFilteredModels();

    renderModelList(filtered);
    renderModelsTable(filtered);

    showModelsStatus("Model filters applied successfully.", "success");
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await loadEnabledModelsState();

        renderModelList(models);
        renderModelsTable(models);
        updateSelectedModel(selectedModel);

        document.getElementById("filterModelsBtn").addEventListener("click", applyFilters);

        document.getElementById("viewAnalyticsBtn").addEventListener("click", () => {
            window.location.href = "/analytics";
        });

        document.getElementById("runPredictionBtn").addEventListener("click", () => {
            window.location.href = "/dashboard";
        });

        document.getElementById("toggleModelBtn").addEventListener("click", async () => {
            try {
                await toggleModel(selectedModel.name);
            } catch (error) {
                showModelsStatus(error.message, "error");
            }
        });

    } catch (error) {
        showModelsStatus(error.message, "error");
    }
});