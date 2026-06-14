const re = new RegExp("\\brev\\.\\s*[12]\\s*\\((?:explosive|fixed)\\)", "ig");
console.log("P-GM Rev. 1 (Explosive)".replace(re, ""));
console.log("P-GM Rev. 2 (Fixed)".replace(re, ""));
