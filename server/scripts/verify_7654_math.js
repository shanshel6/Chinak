const base = 1600;
const domestic = 600;
const cost = base + domestic;
const withProfit = cost * 1.15;
const rounded = Math.ceil(withProfit / 250) * 250;

console.log({
    base,
    domestic,
    cost,
    withProfit,
    rounded
});
