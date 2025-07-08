# ==============================================================================
# CELL 1: INSTALL DEPENDENCIES
# ==============================================================================
# This cell ensures all required libraries are installed in the Colab environment.
# Using -q for a quieter installation.
!pip install -q cloudinary websockets numpy tensorflow

# ==============================================================================
# CELL 2: IMPORTS AND CONFIGURATION
# ==============================================================================
import os
import json
import math
import zipfile
import asyncio
import logging
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
# Set up professional logging for clear, informative output
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - [%(funcName)s] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# --- Load Credentials & Environment Variables ---
# --- Load Credentials & Environment Variables ---
# Tries to load from Colab Secrets first, then falls back to environment variables or defaults.

try:
    from google.colab import userdata
    try:
        CLOUDINARY_CLOUD_NAME = userdata.get('CLOUDINARY_CLOUD_NAME')
        CLOUDINARY_API_KEY = userdata.get('CLOUDINARY_API_KEY')
        CLOUDINARY_API_SECRET = userdata.get('CLOUDINARY_API_SECRET')
        DERIV_API_TOKEN = userdata.get('DERIV_API_TOKEN') or "JklMzewtX7Da9mT"
        SYMBOL = userdata.get('SYMBOL') or "stpRNG"
        logging.info("✅ Loaded credentials from Colab Secrets.")
    except Exception as e:
        raise RuntimeError("⚠️ Some Colab secrets are missing.") from e

except Exception:
    logging.warning("⚠️ Colab Secrets not found or incomplete. Using fallback environment variables or hardcoded defaults.")
    CLOUDINARY_CLOUD_NAME = os.environ.get('CLOUDINARY_CLOUD_NAME', 'dj4bwntzb')
    CLOUDINARY_API_KEY = os.environ.get('CLOUDINARY_API_KEY', '354656419316393')
    CLOUDINARY_API_SECRET = os.environ.get('CLOUDINARY_API_SECRET', 'M-Trl9ltKDHyo1dIP2AaLOG-WPM')
    DERIV_API_TOKEN = os.environ.get('DERIV_API_TOKEN', "JklMzewtX7Da9mT")
    SYMBOL = os.environ.get('SYMBOL', "stpRNG")


# Configure Cloudinary SDK
cloudinary.config(
    cloud_name=CLOUDINARY_CLOUD_NAME,
    api_key=CLOUDINARY_API_KEY,
    api_secret=CLOUDINARY_API_SECRET,
    secure=True
)
PUBLIC_ID = 'libra_v4_python.zip'

# --- Deriv API & Model Constants ---
# Symbol from your env file
SYMBOL = os.environ.get('SYMBOL', "stpRNG")
DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089'
WINDOW_SIZE = 295
PREDICTION_STEPS = 5
MIN_TICKS_REQUIRED = WINDOW_SIZE + PREDICTION_STEPS + 4  # 304

# ==============================================================================
# CELL 3: CORE MODEL & OPTIMIZER
# ==============================================================================

def get_optimizer():
    """Returns a shared Adam optimizer instance with gradient clipping."""
    return tf.keras.optimizers.Adam(learning_rate=0.001, beta_1=0.9, beta_2=0.999, epsilon=1e-8, clipnorm=5.0)

def build_model():
    """Builds, compiles, and summarizes the LSTM model."""
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(WINDOW_SIZE, 1), name="input_layer"),
        tf.keras.layers.LSTM(64, return_sequences=True, name="lstm_1"),
        tf.keras.layers.Dropout(0.2, name="dropout_1"),
        tf.keras.layers.LSTM(32, name="lstm_2"),
        tf.keras.layers.Dense(PREDICTION_STEPS, activation='linear', name="output_layer")
    ], name="Libra_v4_Model")
    
    model.compile(optimizer=get_optimizer(), loss='mean_squared_error', metrics=['mae'])
    logging.info("🧠 Model built successfully.")
    model.summary(print_fn=logging.info)
    return model

# ==============================================================================
# CELL 4: OPTIMIZED DATASET EXTRACTION (Libra3.js Style)
# ==============================================================================

def extract_dataset(ticks):
    """
    A highly optimized, vectorized Python implementation of the Libra3.js data extraction logic.
    This function avoids slow Python loops by using NumPy array operations,
    resulting in a massive performance boost.
    """
    logging.info("Running optimized vectorized dataset extraction...")
    if len(ticks) < MIN_TICKS_REQUIRED:
        logging.warning(f"Insufficient ticks ({len(ticks)}). Need at least {MIN_TICKS_REQUIRED}.")
        return None, None

    # 1. Pre-computation: Convert to NumPy array and calculate log returns once.
    ticks_arr = np.array(ticks, dtype=np.float64)
    # Clipping ensures log(0) or log(negative) does not occur.
    safe_ticks = np.clip(ticks_arr, 1e-9, None)
    log_returns = np.log(safe_ticks[1:] / safe_ticks[:-1])

    # 2. Feature Engineering (Vectorized)
    # Calculate all 5-period SMAs at once using a sliding window view.
    sma5 = np.mean(as_strided(safe_ticks, shape=(len(ticks) - 4, 5), strides=(ticks_arr.itemsize, ticks_arr.itemsize)), axis=1)
    
    # The first feature: log(tick[i+4] / sma[i]) for all samples.
    # We align the arrays to perform this calculation simultaneously.
    sma_base_ticks = safe_ticks[4:len(sma5) + 4]
    sma_feature = np.log(sma_base_ticks / sma5)

    # 3. Create Sliding Windows using as_strided (a zero-copy, highly efficient method)
    n_samples = len(ticks) - MIN_TICKS_REQUIRED + 1
    itemsize = log_returns.itemsize

    # Create windows for the main body of the input features (the next 294 log returns)
    input_log_returns_windows = as_strided(
        log_returns[4:], shape=(n_samples, WINDOW_SIZE - 1), strides=(itemsize, itemsize)
    )

    # Create windows for the labels (the 5 log returns to be predicted)
    label_start_index = WINDOW_SIZE + 3
    output_label_windows = as_strided(
        log_returns[label_start_index:], shape=(n_samples, PREDICTION_STEPS), strides=(itemsize, itemsize)
    )

    # 4. Assemble the final dataset
    X = np.concatenate((sma_feature[:n_samples, np.newaxis], input_log_returns_windows), axis=1)
    Y = output_label_windows

    # 5. Final Cleaning: Remove any rows containing NaN or Infinity for training stability.
    valid_indices = np.all(np.isfinite(X), axis=1) & np.all(np.isfinite(Y), axis=1)
    X_clean, Y_clean = X[valid_indices], Y[valid_indices]

    if X_clean.shape[0] == 0:
        logging.warning("Vectorized extraction produced no valid samples after cleaning.")
        return None, None

    logging.info(f"✅ Vectorized extraction complete. Found {X_clean.shape[0]} valid samples.")
    # Reshape X for LSTM (samples, timesteps, features) and cast to float32 for TF.
    return X_clean[:, :, np.newaxis].astype(np.float32), Y_clean.astype(np.float32)

# ==============================================================================
# CELL 5: TRAINING & PERSISTENCE
# ==============================================================================

def train_model(model, ticks, epochs=50, batch_size=64):
    """
    Trains the model using the optimized in-memory dataset extraction.
    Includes validation to ensure enough data exists for at least one batch.
    """
    logging.info("Starting model training process...")
    xs, ys = extract_dataset(ticks)

    if xs is None or ys is None or xs.shape[0] < batch_size:
        logging.error(f"💥 Training halted. Not enough valid samples ({xs.shape[0] if xs is not None else 0}) for one batch of size {batch_size}.")
        return model, False

    logging.info(f"📦 Training model on {xs.shape[0]} samples...")
    model.fit(
        xs, ys, epochs=epochs, batch_size=batch_size, shuffle=True, validation_split=0.1,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=5, restore_best_weights=True, verbose=1),
            tf.keras.callbacks.LambdaCallback(on_epoch_end=lambda e, logs: logging.info(
                f"Epoch {e+1}/{epochs} -> Loss: {logs['loss']:.6f} | Val Loss: {logs['val_loss']:.6f}"
            ))
        ]
    )
    logging.info("✅ Model training complete.")
    return model, True

def save_model_to_cloudinary(model, public_id=PUBLIC_ID):
    """Saves the model locally, zips it, and uploads to Cloudinary."""
    save_dir, zip_path = '/tmp/model_dir', '/tmp/model.zip'
    try:
        model.save(save_dir)
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(save_dir):
                for file in files:
                    zf.write(os.path.join(root, file), os.path.relpath(os.path.join(root, file), save_dir))
        response = cloudinary.uploader.upload(zip_path, resource_type="raw", public_id=public_id, overwrite=True)
        logging.info(f"☁️ Model uploaded: {response.get('secure_url')}")
        return True
    except Exception as e:
        logging.error(f"💥 Failed to save model to Cloudinary: {e}", exc_info=True)
        return False

def load_model_from_cloudinary(public_id=PUBLIC_ID):
    """Downloads, unzips, and loads a Keras model from Cloudinary."""
    model_dir = '/tmp/model_dir_downloaded'
    try:
        url = cloudinary.api.resource(public_id, resource_type='raw')['secure_url']
        logging.info(f"📥 Downloading model from Cloudinary...")
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        with BytesIO(response.content) as zf, zipfile.ZipFile(zf, 'r') as zr:
            zr.extractall(model_dir)
        model = tf.keras.models.load_model(model_dir, compile=False) # Compile separately
        model.compile(optimizer=get_optimizer(), loss='mean_squared_error', metrics=['mae'])
        logging.info("✅ Model loaded successfully from Cloudinary.")
        return model
    except cloudinary.api.NotFound:
        logging.warning(f"Model '{public_id}' not found on Cloudinary. A new model will be built.")
        return None
    except Exception as e:
        logging.error(f"💥 Failed to load model from Cloudinary: {e}", exc_info=True)
        return None

# ==============================================================================
# CELL 6: DERIV CLIENT & MAIN EXECUTION
# ==============================================================================

async def get_ticks_from_deriv(symbol, count):
    """Fetches a specified number of historical ticks from Deriv using WebSockets."""
    all_ticks = []
    logging.info(f"Connecting to Deriv to fetch {count} ticks for '{symbol}'...")
    try:
        async with websockets.connect(DERIV_WS_URL) as ws:
            await ws.send(json.dumps({"authorize": DERIV_API_TOKEN}))
            if 'error' in json.loads(await ws.recv()):
                raise ConnectionRefusedError("Deriv authentication failed.")
            
            await ws.send(json.dumps({"ticks_history": symbol, "end": "latest", "count": count, "style": "ticks"}))
            while len(all_ticks) < count:
                data = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                if 'history' in data:
                    prices = [float(p) for p in data.get('history', {}).get('prices', [])]
                    if not prices: break
                    all_ticks.extend(prices)
                    logging.info(f"Received {len(prices)} ticks. Total: {len(all_ticks)}/{count}")
                elif 'error' in data:
                    raise ConnectionError(f"Deriv API error: {data['error']['message']}")
    except Exception as e:
        logging.error(f"💥 WebSocket connection failed: {e}", exc_info=True)
    return all_ticks[:count]

async def main():
    """Main function to orchestrate the AI model lifecycle."""
    logging.info("--- Starting Libra AI Trader ---")
    
    model = load_model_from_cloudinary()
    if model is None:
        model = build_model()

    # Fetch a substantial dataset for robust training.
    ticks = await get_ticks_from_deriv(symbol=SYMBOL, count=20000)
    if not ticks:
        logging.critical("Could not fetch any ticks. Exiting.")
        return

    model, training_success = await asyncio.to_thread(
        train_model, model, ticks, epochs=15, batch_size=64
    )

    if training_success:
        await asyncio.to_thread(save_model_to_cloudinary, model)
    else:
        logging.error("Model training failed. Skipping save to cloud.")

# --- RUN THE SCRIPT ---
if __name__ == "__main__" and 'google.colab' in str(get_ipython()):
    if not all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, DERIV_API_TOKEN]):
        logging.error("🚨 CRITICAL: Credentials not set. Go to 'Secrets' (key icon) and add them.")
    else:
        asyncio.run(main())
