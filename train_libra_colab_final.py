
# ✅ Install dependencies (Colab-safe)
!pip install cloudinary websockets websocket-client requests numpy tensorflow

# 🧠 Libra Training on Deriv Ticks + Cloudinary model loading
import os, json, math, zipfile, asyncio
import numpy as np
import requests
import tensorflow as tf
import cloudinary
import websockets

from cloudinary.uploader import upload
from cloudinary.utils import cloudinary_url
from datetime import datetime

# === Cloudinary Config ===
cloudinary.config(
    cloud_name='dj4bwntzb',
    api_key='354656419316393',
    api_secret='M-Trl9ltKDHyo1dIP2AaLOG-WPM'
)
public_id = 'libra_v4.zip'

# === Deriv API Constants ===
DERIV_TOKEN = 'your_token_here'  # 🔐 Set your real token here
SYMBOL = 'R_100'
DERIV_WS = 'wss://ws.derivws.com/websockets/v3?app_id=1089'

# === Optimizer ===
def get_optimizer():
    return tf.keras.optimizers.Adam(learning_rate=0.001, beta_1=0.9, beta_2=0.999, epsilon=1e-8, clipnorm=5)

# === Model Structure ===
def build_model():
    model = tf.keras.Sequential([
        tf.keras.layers.LSTM(64, input_shape=(295, 1), return_sequences=True),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.LSTM(32),
        tf.keras.layers.Dense(5)
    ])
    model.compile(optimizer=get_optimizer(), loss='mse', metrics=['mae'])
    return model

# === Load Model from Cloudinary ===
def load_model_from_cloudinary():
    model_dir = '/tmp/model_dir'
    zip_path = '/tmp/downloaded_model.zip'
    url = cloudinary_url(public_id, resource_type='raw', type='upload')[0]
    r = requests.get(url, stream=True)
    with open(zip_path, 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(model_dir)
    model = tf.keras.models.load_model(model_dir)
    model.compile(optimizer=get_optimizer(), loss='mse', metrics=['mae'])
    print("✅ Model loaded from Cloudinary")
    return model

# === Tick Extractor (trainWithTicks style) ===
def extract_dataset(ticks):
    inputs, labels = [], []
    for i in range(len(ticks) - 295 - 5 - 4):
        try:
            sma = sum(ticks[i:i+5]) / 5
            input_seq = [[math.log(max(1e-7, min(ticks[i+4]/sma, 1e7)))]]
            for j in range(i+4, i+4+294):
                input_seq.append([math.log(max(1e-7, min(ticks[j+1]/ticks[j], 1e7)))])
            label_seq = [math.log(max(1e-7, min(ticks[k+1]/ticks[k], 1e7))) for k in range(i+295+3, i+295+3+5)]
            if all(map(np.isfinite, np.array(input_seq).flatten())) and all(map(np.isfinite, label_seq)):
                inputs.append(input_seq)
                labels.append(label_seq)
        except:
            continue
    return np.array(inputs), np.array(labels)

# === Deriv WebSocket Client to get 86000 ticks ===
async def get_ticks_for_training(symbol='R_100', token='', count=86000):
    uri = DERIV_WS
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({ "authorize": token }))
        await ws.recv()

        all_ticks = []
        chunk = 10000
        end = int(datetime.now().timestamp())

        while count > 0:
            fetch = min(chunk, count)
            start = end - fetch
            await ws.send(json.dumps({
                "ticks_history": symbol,
                "start": start,
                "end": end,
                "style": "ticks"
            }))
            resp = await ws.recv()
            data = json.loads(resp)
            prices = data.get('history', {}).get('prices', [])
            if not prices: break
            all_ticks = prices + all_ticks
            count -= len(prices)
            end = start
        print(f"✅ Got {len(all_ticks)} ticks")
        return [float(p) for p in all_ticks]

# === Training Logic ===
async def main():
    ticks = await get_ticks_for_training(SYMBOL, DERIV_TOKEN)
    xs, ys = extract_dataset(ticks)
    if xs.size == 0:
        print("❌ No valid samples")
        return
    model = load_model_from_cloudinary()
    model.fit(xs, ys, epochs=100, batch_size=32, shuffle=True,
        callbacks=[tf.keras.callbacks.LambdaCallback(
            on_epoch_begin=lambda e, logs: print(f"🚀 Epoch {e+1}/100"),
            on_epoch_end=lambda e, logs: print(f"📉 Loss: {logs['loss']:.6f}")
        )]
    )
    print("✅ Training Complete")

# Run it
asyncio.run(main())
