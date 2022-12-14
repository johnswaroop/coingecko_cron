const express = require("express");
const cors = require("cors");
const compression = require("compression");
const dotenv = require("dotenv");
dotenv.config();
const axios = require('axios')
const fs = require('fs')
const cron = require('node-cron');
const { createClient } = require('redis');

//redis init

const client = createClient({
    url: process.env.REDIS_URL
});

client.on('error', (err) => console.log('Redis Client Error', err));
client.connect().then(() => {
    console.log("redis connected");
});
client.set('test', 'reddis running');

// intialize server
const app = express();
const corsConfig = {
    origin: true,
    credentials: true,
};
app.use(cors(corsConfig));
app.use(compression());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb" }));



let SHEET_URL = `https://api.steinhq.com/v1/storages/62e2315abca21f053ea5d9c6/Bounties%20Paid`;

// fetching the Earning data 
const getSheetData = async () => {
    let res = await axios.get(SHEET_URL);
    return res.data
}

// historic price API
const getHistoricPrice = async (OLDEST_DATE, id) => {
    console.log(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${Math.floor(OLDEST_DATE.getTime() / 1000)}&to=${Math.floor(new Date().getTime() / 1000)}`)
    let res = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${Math.floor(OLDEST_DATE.getTime() / 1000)}&to=${Math.floor(new Date().getTime() / 1000)}`)
    return res.data;
}

const fetchHistoricPriceData = async () => {
    let EARNING_DATA = await getSheetData();
    // let COIN_LIST = await axios.get('https://api.coingecko.com/api/v3/coins/list');
    let COIN_GECKO_LIST = require('./assets/coinList.json');
    let COIN_LIST_ID_MAP = {};
    COIN_GECKO_LIST.forEach((elm) => {
        COIN_LIST_ID_MAP[elm.symbol] = elm
    })

    let dateArray = EARNING_DATA.map((elm) => {
        return createDate(elm['Date Given']);
    })

    let OLDEST_DATE = dateArray[0];
    dateArray.forEach((elm) => {
        if (OLDEST_DATE > elm) {
            OLDEST_DATE = elm
        }
    })
    
    console.log(OLDEST_DATE);

    // required tokens
    let COIN_LIST = {};
    EARNING_DATA.forEach((elm) => {
        try {
            COIN_LIST[elm.Token] = { ...COIN_LIST_ID_MAP[elm.Token.toLowerCase()] };
        } catch (error) {

        }
    });

    //fetch historic price data

    cron_stat.COIN_LIST = COIN_LIST;
    cron_stat.OLDEST_DATE = OLDEST_DATE;
    console.log("Token count = ", Object.keys(cron_stat.COIN_LIST).length)
    await historicPriceDataAPIHandler(cron_stat);
}

async function historicPriceDataAPIHandler(cron_stat) {
    console.log("start index =", cron_stat.start_index);
    let i = cron_stat.start_index;
    while (i < Object.keys(cron_stat.COIN_LIST).length) {
        try {
            let data = await getHistoricPrice(cron_stat.OLDEST_DATE, Object.values(cron_stat.COIN_LIST)[i].id);
            cron_stat.historic_price_obj[Object.keys(cron_stat.COIN_LIST)[i]] = data.prices;
            console.log("current index = ", i);
            cron_stat.start_index = i + 1;
            i++;
        }
        catch (er) {
            console.log(`error ${er.response.statusText} at index ${i} || cooldown for ${cron_stat.COOL_DOWN_TIME / 1000} ||`);
            setTimeout(() => {
                console.log("timeout started");
                historicPriceDataAPIHandler(cron_stat);
            }, cron_stat.COOL_DOWN_TIME)
            break;
        }
    }
    if (cron_stat.start_index == Object.keys(cron_stat.COIN_LIST).length) {
        console.log("Completed")
        // console.log(cron_stat.historic_price_obj);
        const value = await client.set('historic-price-data', JSON.stringify(cron_stat.historic_price_obj));
        return true
    }
}

let cron_stat = { start_index: 0, historic_price_obj: {}, COIN_LIST: {}, OLDEST_DATE: null, COOL_DOWN_TIME: 60000 }

cron.schedule(`30 11 * * *`, async () => {
    console.log("Cron job started")
    await fetchHistoricPriceData();
    console.log("Cron job completed @ ", new Date());
});

app.get('/', async (req, res) => {
    let data = await getSheetData();
    res.send(data);
})

app.get('/redis-test', async (req, res) => {
    const value = await client.get('test');
    res.send(value);
})

app.get('/force-update', async (req, res) => {
    fetchHistoricPriceData();
    res.send("force Cron job started");
})

const port = 5000;
app.listen(port, () => {
    console.log("Server is up and running on port number " + port);
});

//create date 
let createDate = (date) => {
    let data_string = date + " " + 'EDT';
    return new Date(data_string);
}
