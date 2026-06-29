# app.py
from flask import Flask, request, jsonify

import pandas as pd
import splink.comparison_library as cl
from splink import DuckDBAPI, Linker, SettingsCreator, block_on
app = Flask(__name__)

@app.route("/payees", methods=["POST"])
def payees():
    body = request.get_json(silent=True)

    if not body or "data" not in body:
        return jsonify({"error": "Missing data"}), 400

    records = [{"unique_id":x["id"], "name":x['name']} for x in body["data"]]
    #print(records)
    df = pd.DataFrame(records)

    # later you call:
    # df_clusters = run_dedupe_linking(...)

    # 2. Configure Settings (Fuzzy matching on names, Exact on DOB/City)
    settings = SettingsCreator(
        link_type="dedupe_only",
        comparisons=[
            cl.LevenshteinAtThresholds("name", distance_threshold_or_thresholds=[1, 2]),
        ],
    )
    name_prefix_block = "substr(l.name, 1, 5) = substr(r.name, 1, 5)"
    # 3. Initialize Linker & Train Model
    linker = Linker(df, settings, db_api=DuckDBAPI())

    linker.training.estimate_probability_two_random_records_match(
        [name_prefix_block],
        recall=0.4,
    )
    linker.training.estimate_u_using_random_sampling(max_pairs=1e6)
    #linker.training.estimate_parameters_using_expectation_maximisation(name_prefix_block)

    # 4. Predict & Cluster
    pairwise_predictions = linker.inference.predict(threshold_match_weight=-5)

    clusters = linker.clustering.cluster_pairwise_predictions_at_threshold(
        pairwise_predictions, 0.90
    )

    df_clusters = clusters.as_pandas_dataframe()
    # 5. Results
    print(df_clusters[["cluster_id", "name"]])

    return jsonify({
        "ok": True,
        "received": len(records),
        "clusters": df_clusters.to_dict(orient="records"),
    })
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
