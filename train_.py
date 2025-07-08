# ==============================================================================
# CELL 1: INSTALL DEPENDENCIES
# ==============================================================================
!pip install -q cloudinary websockets numpy tensorflow tensorflowjs

# ==============================================================================
# CELL 2: IMPORTS AND CONFIGURATION
# ==============================================================================
import os
import json
import math
import zipfile
import asyncio
import logging
import subprocess
from io import BytesIO

import numpy as np
from numpy.lib.stride_tricks import as_strided
import requests
import tensorflow as tf
import cloudinary
import cloudinary.uploader
import cloudinary.api
import websockets

# --- Configuration ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - [%(funcName)s] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# --- Load Credentials ---
try:
    from google.colab import userdata
    CLOUDINARY_CLOUD_NAME = userdata.get('CLOUDINARY_CLOUD_NAME')
    CLOUDINARY_API_KEY = userdata.get('CLOUDINARY_API_KEY')
    CLOUDINARY_API_SECRET = userdata.get('CLOUDINARY_API_SECRET')
    DERIV_API_TOKEN = userdata.get('DERIV_API_TOKEN') or "JklMzewtX7Da9mT"
    SYMBOL = userdata.get('SYMBOL') or "stpRNG"
    logging.info("✅ Loaded credentials from Colab Secrets.")
except Exception:
    logging.warning("⚠️ Colab Secrets not found. Using fallbacks.")
    CLOUDINARY_CLOUD_NAME = os.environ.get('CLOUDINARY_CLOUD_NAME', 'dj4bwntzb')
    CLOUDINARY_API_KEY = os.environ.get('CLOUDINARY_API_KEY', '354656419316393')
    CLOUDINARY_API_SECRET = os.environ.get('CLOUDINARY_API_SECRET', 'M-Trl9ltKDHyo1dIP2AaLOG-WPM')
    DERIV_API_TOKEN = os.environ.get('DERIV_API_TOKEN', "JklMzewtX7Da9mT")
    SYMBOL = os.environ.get('SYMBOL', "stpRNG")

cloudinary.config(
    cloud_name=CLOUDINARY_CLOUD_NAME,
    api_key=CLOUDINARY_API_KEY,
    api_secret=CLOUDINARY_API_SECRET,
    secure=True
)

PUBLIC_ID = 'libra_v4_python.zip'
DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089'
WINDOW_SIZE = 295
PREDICTION_STEPS = 5
MIN_TICKS_REQUIRED = WINDOW_SIZE + PREDICTION_STEPS + 4

# ==============================================================================
# CELL 3: CORE MODEL & OPTIMIZER
# ==============================================================================
def get_optimizer():
    return tf.keras.optimizers.Adam(0.001, 0.9, 0.999, 1e-8, clipnorm=5.0)

def build_model():
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(WINDOW_SIZE, 1)),
        tf.keras.layers.LSTM(64, return_sequences=True),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.LSTM(32),
        tf.keras.layers.Dense(PREDICTION_STEPS)
    ])
    model.compile(optimizer=get_optimizer(), loss='mean_squared_error', metrics=['mae'])
    logging.info("🧠 Model built successfully.")
    model.summary(print_fn=logging.info)
    return model

# ==============================================================================
# CELL 4: DATASET EXTRACTION
# ==============================================================================
def extract_dataset(ticks):
    logging.info("Running vectorized dataset extraction...")
    if len(ticks) < MIN_TICKS_REQUIRED:
        logging.warning("Insufficient ticks.")
        return None, None

    ticks_arr = np.array(ticks, dtype=np.float64)
    safe_ticks = np.clip(ticks_arr, 1e-9, None)
    log_returns = np.log(safe_ticks[1:] / safe_ticks[:-1])

    sma5 = np.mean(as_strided(safe_ticks, shape=(len(ticks) - 4, 5), strides=(ticks_arr.itemsize, ticks_arr.itemsize)), axis=1)
    sma_base_ticks = safe_ticks[4:len(sma5) + 4]
    sma_feature = np.log(sma_base_ticks / sma5)

    n_samples = len(ticks) - MIN_TICKS_REQUIRED + 1
    itemsize = log_returns.itemsize
    input_log_windows = as_strided(log_returns[4:], shape=(n_samples, WINDOW_SIZE - 1), strides=(itemsize, itemsize))
    output_windows = as_strided(log_returns[WINDOW_SIZE + 3:], shape=(n_samples, PREDICTION_STEPS), strides=(itemsize, itemsize))

    X = np.concatenate((sma_feature[:n_samples, np.newaxis], input_log_windows), axis=1)
    Y = output_windows

    valid = np.all(np.isfinite(X), axis=1) & np.all(np.isfinite(Y), axis=1)
    X, Y = X[valid], Y[valid]
    if X.shape[0] == 0:
        logging.warning("No valid samples.")
        return None, None

    return X[:, :, np.newaxis].astype(np.float32), Y.astype(np.float32)

# ==============================================================================
# CELL 5: TRAINING & MODEL I/O
# ==============================================================================
def train_model(model, ticks, epochs=50, batch_size=64):
    xs, ys = extract_dataset(ticks)
    if xs is None or ys is None or xs.shape[0] < batch_size:
        logging.error("Insufficient training samples.")
        return model, False
    model.fit(xs, ys, epochs=epochs, batch_size=batch_size, shuffle=True, validation_split=0.1,
              callbacks=[
                  tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=5, restore_best_weights=True),
                  tf.keras.callbacks.LambdaCallback(on_epoch_end=lambda e, logs: logging.info(
                      f"Epoch {e+1}: Loss={logs['loss']:.6f}, Val={logs['val_loss']:.6f}"))
              ])
    return model, True

def save_model_to_cloudinary(model, public_id=PUBLIC_ID):
    save_dir, zip_path = '/tmp/model_dir', '/tmp/model.zip'
    try:
        model.save(save_dir)
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(save_dir):
                for file in files:
                    zf.write(os.path.join(root, file), os.path.relpath(os.path.join(root, file), save_dir))
        cloudinary.uploader.upload(zip_path, resource_type="raw", public_id=public_id, overwrite=True)
        logging.info("☁️ Model uploaded to Cloudinary.")
        return True
    except Exception as e:
        logging.error(f"Save failed: {e}", exc_info=True)
        return False

def load_model_from_cloudinary(public_id=PUBLIC_ID):
    model_dir = '/tmp/model_dir_downloaded'
    try:
        url = cloudinary.api.resource(public_id, resource_type='raw')['secure_url']
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        with BytesIO(response.content) as zf, zipfile.ZipFile(zf, 'r') as zr:
            zr.extractall(model_dir)
        layer = tf.keras.layers.TFSMLayer(model_dir, call_endpoint='serving_default')
        inputs = tf.keras.Input(shape=(WINDOW_SIZE, 1))
        outputs = layer(inputs)
        model = tf.keras.Model(inputs, outputs)
        model.compile(optimizer=get_optimizer(), loss='mean_squared_error', metrics=['mae'])
        logging.info("✅ Model loaded via TFSMLayer.")
        return model
    except cloudinary.api.NotFound:
        logging.warning("Model not found. Building new.")
        return None
    except Exception as e:
        logging.error(f"Load failed: {e}", exc_info=True)
        return None

# ==============================================================================
# CELL 6: TICK FETCHING
# ==============================================================================
async def get_ticks_from_deriv(symbol, count):
    all_ticks = []
    try:
        async with websockets.connect(DERIV_WS_URL) as ws:
            await ws.send(json.dumps({"authorize": DERIV_API_TOKEN}))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                if msg.get("msg_type") == "authorize":
                    break
            await ws.send(json.dumps({"ticks_history": symbol, "end": "latest", "count": count, "style": "ticks"}))
            while len(all_ticks) < count:
                data = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                if 'history' in data:
                    prices = [float(p) for p in data['history'].get('prices', [])]
                    all_ticks.extend(prices)
                    logging.info(f"📈 {len(all_ticks)}/{count} ticks.")
                elif 'error' in data:
                    raise RuntimeError(f"Tick error: {data['error']['message']}")
    except Exception as e:
        logging.error(f"Tick fetch failed: {e}", exc_info=True)
    return all_ticks[:count]

# ==============================================================================
# MAIN
# ==============================================================================
async def main():
    model = load_model_from_cloudinary()
    if model is None:
        model = build_model()
    ticks = await get_ticks_from_deriv(symbol=SYMBOL, count=20000)
    if not ticks:
        logging.critical("No ticks. Exiting.")
        return
    model, ok = await asyncio.to_thread(train_model, model, ticks, 15, 64)
    if ok:
        await asyncio.to_thread(save_model_to_cloudinary, model)

if __name__ == "__main__" and 'google.colab' in str(get_ipython()):
    if not all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, DERIV_API_TOKEN]):
        logging.error("🚨 Missing credentials.")
    else:
        asyncio.run(main())
