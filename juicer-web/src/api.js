import axios from "axios";

const API = axios.create({
  baseURL: "https://juicer-system.onrender.com",
});

export default API;