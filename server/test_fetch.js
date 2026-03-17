async function testFetch() {
  const url = "https://img.alicdn.com/bao/uploaded/i2/O1CN01wGupXP1HWsT6Db0T0_!!4611686018427387054-0-fleamarket.jpg";
  try {
    const res = await fetch(url);
    console.log("Status:", res.status);
    console.log("Status Text:", res.statusText);
    const text = await res.text();
    console.log("Response Body (first 100 chars):", text.substring(0, 100));
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}
testFetch();
