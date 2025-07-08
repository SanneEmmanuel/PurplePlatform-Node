# ==============================================================================
# INSTALL DEPENDENCIES & IMPORTS
# ==============================================================================
!pip install -q cloudinary websockets numpy tensorflow tensorflowjs
import os, json, zipfile, asyncio, logging, time
from io import BytesIO
import numpy as np
from numpy.lib.stride_tricks import as_strided
import requests, tensorflow as tf, cloudinary, websockets
import tensorflowjs as tfjs
from cloudinary import uploader, api, config

# --- Configuration ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - [%(funcName)s] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# --- Load Credentials ---
ENV_CREDS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'DERIV_API_TOKEN']
creds = {k: os.environ.get(k, 'dj4bwntzb|354656419316393|M-Trl9ltKDHyo1dIP2AaLOG-WPM|JklMzewtX7Da9mT'.split('|')[i]) 
         for i, k in enumerate(ENV_CREDS)}
config(
    cloud_name=creds['CLOUDINARY_CLOUD_NAME'],
    api_key=creds['CLOUDINARY_API_KEY'],
    api_secret=creds['CLOUDINARY_API_SECRET'],
    secure=True
)

SYMBOL = os.environ.get('SYMBOL', "stpRNG")
PUBLIC_ID = 'libra_v4'
DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089'
WINDOW_SIZE, PREDICTION_STEPS = 295, 5
MIN_TICKS_REQUIRED = WINDOW_SIZE + PREDICTION_STEPS + 4
RETRY_DELAYS = [1, 2, 4, 8, 16]  # Exponential backoff delays

# ==============================================================================
# CORE MODEL & DATA PROCESSING
# ==============================================================================
def build_model():
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(WINDOW_SIZE, 1)),
        tf.keras.layers.LSTM(64, return_sequences=True),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.LSTM(32),
        tf.keras.layers.Dense(PREDICTION_STEPS)
    ])
    model.compile(
        optimizer=tf.keras.optimizers.Adam(0.001, 0.9, 0.999, 1e-8, clipnorm=5.0),
        loss='mean_squared_error',
        metrics=['mae']
    )
    logging.info("🧠 Model built")
    return model

def extract_dataset(ticks):
    if len(ticks) < MIN_TICKS_REQUIRED:
        logging.warning("Insufficient ticks")
        return None, None

    ticks_arr = np.array(ticks, dtype=np.float64)
    safe_ticks = np.clip(ticks_arr, 1e-9, None)
    log_returns = np.log(safe_ticks[1:] / safe_ticks[:-1])
    
    # Calculate SMA5 using stride tricks for efficiency
    sma5 = np.mean(as_strided(
        safe_ticks, 
        shape=(len(ticks)-4, 5),
        strides=(ticks_arr.itemsize, ticks_arr.itemsize),
        axis=1
    ))
    sma_feature = np.log(safe_ticks[4:len(sma5)+4] / sma5)
    
    # Create input/output windows using stride tricks
    n = len(ticks) - MIN_TICKS_REQUIRED + 1
    itemsize = log_returns.itemsize
    X = np.concatenate((
        sma_feature[:n, None],
        as_strided(log_returns[4:], 
                   shape=(n, WINDOW_SIZE-1),
                   strides=(itemsize, itemsize))
    ), axis=1)
    Y = as_strided(log_returns[WINDOW_SIZE+3:], 
                   shape=(n, PREDICTION_STEPS),
                   strides=(itemsize, itemsize))
    
    # Validate finite values
    valid = np.all(np.isfinite(X), axis=1) & np.all(np.isfinite(Y), axis=1)
    X, Y = X[valid], Y[valid]
    return (X[..., None].astype(np.float32), Y.astype(np.float32)) if X.size else (None, None)

# ==============================================================================
# MODEL I/O WITH RETRY MECHANISMS
# ==============================================================================
def save_models_with_retry(model, max_retries=3):
    for attempt in range(max_retries):
        try:
            # Save TensorFlow model
            tf_model_path = '/tmp/tf_model'
            model.save(tf_model_path)
            with zipfile.ZipFile(f'{tf_model_path}.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
                for root, _, files in os.walk(tf_model_path):
                    for f in files: 
                        zf.write(os.path.join(root, f), os.path.relpath(os.path.join(root, f), tf_model_path))
            uploader.upload(f'{tf_model_path}.zip', resource_type="raw", public_id=PUBLIC_ID, overwrite=True)
            
            # Save TensorFlow.js model
            tfjs_path = '/tmp/tfjs_model'
            tfjs.converters.save_keras_model(model, tfjs_path)
            with zipfile.ZipFile(f'{tfjs_path}.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
                for f in os.listdir(tfjs_path): 
                    zf.write(os.path.join(tfjs_path, f), f)
            uploader.upload(f'{tfjs_path}.zip', resource_type="raw", public_id=f'{PUBLIC_ID}_tfjs', overwrite=True)
            
            logging.info("☁️ Models uploaded successfully")
            return True
        except Exception as e:
            logging.warning(f"Upload attempt {attempt+1}/{max_retries} failed: {str(e)}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
    return False

def load_model_with_retry(max_retries=3):
    for attempt in range(max_retries):
        try:
            # Try loading TensorFlow model
            url = api.resource(PUBLIC_ID, resource_type='raw')['secure_url']
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            
            with BytesIO(response.content) as buf, zipfile.ZipFile(buf) as zf:
                model_dir = '/tmp/loaded_model'
                zf.extractall(model_dir)
                
            # Handle potential SavedModel format
            if os.path.exists(os.path.join(model_dir, 'saved_model.pb')):
                model = tf.keras.models.load_model(model_dir)
            else:
                # Handle legacy format
                layer = tf.keras.layers.TFSMLayer(model_dir, call_endpoint='serving_default')
                inputs = tf.keras.Input(shape=(WINDOW_SIZE, 1))
                outputs = layer(inputs)
                model = tf.keras.Model(inputs, outputs)
                model.compile(
                    optimizer=tf.keras.optimizers.Adam(0.001, 0.9, 0.999, 1e-8, clipnorm=5.0),
                    loss='mean_squared_error',
                    metrics=['mae']
                )
                
            logging.info("✅ Model loaded successfully")
            return model
        except Exception as e:
            logging.warning(f"Load attempt {attempt+1}/{max_retries} failed: {str(e)}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
    logging.info("🆕 Building new model")
    return build_model()

# ==============================================================================
# TICK FETCHING WITH RETRY MECHANISM
# ==============================================================================
async def get_ticks_with_retry(symbol, count=20000, max_retries=5):
    for attempt in range(max_retries):
        try:
            async with websockets.connect(DERIV_WS_URL) as ws:
                # Authorize connection
                await ws.send(json.dumps({"authorize": creds['DERIV_API_TOKEN']}))
                
                # Wait for authorization response
                auth_response = None
                while not auth_response:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                    if msg.get("msg_type") == "authorize":
                        auth_response = msg
                        if "error" in auth_response:
                            raise RuntimeError(f"Auth error: {auth_response['error']['message']}")
                
                # Request ticks
                await ws.send(json.dumps({
                    "ticks_history": symbol,
                    "end": "latest",
                    "count": count,
                    "style": "ticks"
                }))
                
                # Collect ticks
                ticks = []
                while len(ticks) < count:
                    data = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                    if 'history' in data:
                        ticks.extend(map(float, data['history'].get('prices', [])))
                        logging.info(f"📈 Received {len(ticks)}/{count} ticks")
                    elif 'error' in data:
                        raise RuntimeError(f"API error: {data['error']['message']}")
                    elif 'subscription' in data:
                        continue  # Skip subscription messages
                return ticks[:count]
        except (websockets.ConnectionClosed, asyncio.TimeoutError) as e:
            logging.warning(f"Connection error: {str(e)}")
        except Exception as e:
            logging.error(f"Tick fetch error: {str(e)}")
        
        # Exponential backoff before retry
        delay = RETRY_DELAYS[attempt] if attempt < len(RETRY_DELAYS) else RETRY_DELAYS[-1]
        logging.info(f"Retrying in {delay} seconds...")
        await asyncio.sleep(delay)
    
    raise RuntimeError(f"Failed to fetch ticks after {max_retries} attempts")

# ==============================================================================
# TRAINING & MAIN EXECUTION
# ==============================================================================
def train_model(model, ticks, epochs=15, batch_size=64):
    xs, ys = extract_dataset(ticks)
    if xs is None or xs.shape[0] < batch_size:
        logging.error("Insufficient training samples")
        return model, False
        
    model.fit(
        xs, ys, 
        epochs=epochs, 
        batch_size=batch_size, 
        shuffle=True, 
        validation_split=0.1,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor='val_loss', 
                patience=5, 
                restore_best_weights=True,
                verbose=1
            ),
            tf.keras.callbacks.LambdaCallback(
                on_epoch_end=lambda epoch, logs: logging.info(
                    f"Epoch {epoch+1}: loss={logs['loss']:.6f}, val_loss={logs['val_loss']:.6f}")
            )
        ],
        verbose=0
    )
    return model, True

async def main():
    # Load model with retry mechanism
    model = await asyncio.to_thread(load_model_with_retry)
    
    # Fetch ticks with retry mechanism
    try:
        ticks = await get_ticks_with_retry(SYMBOL)
    except Exception as e:
        logging.critical(f"🚨 Tick fetch failed: {str(e)}")
        return
    
    # Train and save models
    model, ok = await asyncio.to_thread(train_model, model, ticks)
    if ok:
        save_success = await asyncio.to_thread(save_models_with_retry, model)
        if not save_success:
            logging.error("Model save failed after retries")

if __name__ == "__main__":
    if all(creds.values()):
        asyncio.run(main())
    else:
        logging.error("🚨 CRITICAL: Missing credentials")
