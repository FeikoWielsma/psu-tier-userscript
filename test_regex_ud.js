const re = new RegExp("\\bud\\s*(\\d{3,4})\\s*([a-z]{2})\\b", "ig");
console.log("Gigabyte UD1000GM".replace(re, "Ultra Durable UD-$2 $1"));
console.log("Gigabyte UD850GM PG5".replace(re, "Ultra Durable UD-$2 $1"));
console.log("Gigabyte UD1600PM AI TOP".replace(re, "Ultra Durable UD-$2 $1"));
