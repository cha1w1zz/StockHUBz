"""Web app: user brings own OpenRouter key. Key is used for one request only, never stored."""
import requests
import streamlit as st
from streamlit_local_storage import LocalStorage

from news import fetch_news, fetch_price, summarize

MODEL = "google/gemini-2.5-flash-lite"

st.set_page_config(page_title="สรุปข่าวหุ้น", page_icon="📈")
st.title("📈 สรุปข่าวหุ้นไทย")
st.caption("ดึงข่าว 2 วันล่าสุด + ราคา แล้วให้ AI สรุป · ไม่ใช่คำแนะนำการลงทุน")

with st.expander("🔒 เรื่องความปลอดภัยของ API key"):
    st.markdown(
        "- เว็บนี้**ไม่บันทึก key** ใช้แค่ตอนกดสรุปแล้วทิ้ง\n"
        "- ถ้าติ๊ก \"จำ key\" key จะเก็บใน**เบราว์เซอร์เครื่องนี้**เท่านั้น (อย่าติ๊กบนเครื่องที่ใช้ร่วมกับคนอื่น)\n"
        "- แนะนำให้**สร้าง key แยก**ที่ openrouter.ai/keys และตั้ง credit limit ต่ำๆ (เช่น $1)\n"
        "- ค่าใช้จ่ายประมาณไม่ถึง 0.05 บาทต่อครั้ง"
    )

store = LocalStorage()
saved_key = store.getItem("or_key") or ""
key = st.text_input("OpenRouter API key", value=saved_key, type="password", placeholder="sk-or-v1-...")
remember = st.checkbox("จำ key ในเครื่องนี้", value=bool(saved_key))
if remember and key.startswith("sk-or-") and key != saved_key:
    store.setItem("or_key", key)
elif not remember and saved_key:
    store.eraseItem("or_key")
    store.storedItems.pop("or_key", None)
stocks_text = st.text_input(
    "ชื่อหุ้น (คั่นด้วยเว้นวรรค)", value=st.query_params.get("stocks", "PTT KBANK AOT")
)
st.query_params["stocks"] = stocks_text  # remember in URL for bookmarking

if st.button("สรุปข่าว", type="primary"):
    names = stocks_text.upper().split()[:10]
    if not key.startswith("sk-or-"):
        st.error("ใส่ API key ให้ถูกก่อน (ขึ้นต้นด้วย sk-or-)")
    elif not names:
        st.error("ใส่ชื่อหุ้นอย่างน้อย 1 ตัว")
    else:
        with st.spinner("กำลังดึงข่าวและสรุป..."):
            try:
                parts = [
                    f"## {n}\nราคา: {fetch_price(n + '.BK')}\nข่าว:\n" + "\n".join(fetch_news(n + " หุ้น", 8))
                    for n in names
                ]
                st.markdown(summarize(key, MODEL, "\n\n".join(parts)))
            except requests.HTTPError as e:
                code = e.response.status_code
                st.error("API key ไม่ถูกต้อง" if code == 401 else "เงินใน key หมด" if code == 402 else f"OpenRouter error {code}")
            except Exception as e:
                st.error(f"เกิดข้อผิดพลาด: {type(e).__name__}")
