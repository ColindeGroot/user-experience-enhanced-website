import express, { request } from 'express';
import { Liquid } from 'liquidjs';

// Maak een nieuwe Express-applicatie aan
const app = express();

// Stel de public map in voor statische bestanden (CSS, JS, afbeeldingen, etc.)
app.use(express.static('public'));

// Gebruik middleware om formulierdata en JSON te parsen
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Stel Liquid in als view engine
const engine = new Liquid();
app.engine('liquid', engine.express());
app.set('views', './views');

// Stel de poort in
const PORT = process.env.PORT || 8000;

// ROUTE: Homepage
app.get('/', async (req, res) => {
  try {
    const radiostationsResponse = await fetch('https://fdnd-agency.directus.app/items/mh_radiostations');
    const radiostationsResponseJSON = await radiostationsResponse.json();
  
    res.render('index.liquid', { radiostations: radiostationsResponseJSON.data });
  } catch (error) {
    console.error("Error loading radiostations:", error);
    res.status(500).send("Er is een fout opgetreden.");
  }
});

// ROUTE: Radio-pagina
app.get('/radio/:name', async (req, res) => {
  try {
    // Haal radiostations op en zoek de gewenste station op basis van de naam
    const radiostationsResponse = await fetch('https://fdnd-agency.directus.app/items/mh_radiostations');
    const radiostationsResponseJSON = await radiostationsResponse.json();
    const radiostations = radiostationsResponseJSON.data.map(station => ({  //voor het vergelijken van het station in de shows array
      id: station.id,
      name: station.name
    }));

    let radioName = decodeURIComponent(req.params.name);
    const station = radiostations.find(station => station.name === radioName); // radio is gelijk als die in de shows
    if (!station) { //station niet gevonden? -> error
      return res.status(404).send('Radiostation niet gevonden'); //log als radiostation niet word gevonden (check url op dubbele spaties -> %20, ook in liquid bestand)
    }


    // Haal de shows-per-dag op met extra velden
    const showsPerDayResponse = await fetch('https://fdnd-agency.directus.app/items/mh_day?fields=date,shows.mh_shows_id.from,shows.mh_shows_id.until,shows.mh_shows_id.show.id,shows.mh_shows_id.show.body,shows.mh_shows_id.show.name,shows.mh_shows_id.show.radiostation.*,shows.mh_shows_id.show.users.mh_users_id.*,shows.mh_shows_id.show.users.*.*,shows.*.*.mh_shows_id.show.users.mh_users_id.cover.*');
    const showsPerDayResponseJSON = await showsPerDayResponse.json();

    // Dagmapping:
    const dayMapping = {
      1: "maandag",
      2: "dinsdag",
      3: "woensdag",
      4: "donderdag",
      5: "vrijdag",
      6: "zaterdag",
      0: "zondag" // 0 want zondag heeft geen programma
    };

    // Bepaal de geselecteerde dag via queryparameter of default naar vandaag (of maandag als vandaag zondag is)
    let selectedDay = req.query.day ? req.query.day.toLowerCase() : null;
    if (!selectedDay || selectedDay === "zondag") {
      const currentDayNumber = new Date().getDay();
      selectedDay = (currentDayNumber === 0) ? "maandag" : dayMapping[currentDayNumber];
    }

    // Zoek het dag-item dat overeenkomt met de geselecteerde dag
    const selectedDayShows = showsPerDayResponseJSON.data.find(item => {
      const dayOfWeek = new Date(item.date).getDay();
      return dayMapping[dayOfWeek] === selectedDay;
    });

    // Filter de shows die behoren tot dit radiostation en maak een array met de benodigde data
    const filteredShows = selectedDayShows?.shows
      .filter(show => show.mh_shows_id.show.radiostation.name === radioName)
      .map(show => ({ //de velden omzetten naar data die we mee gaan geven aan de render
        id: show.mh_shows_id.show.id, 
        from: show.mh_shows_id.from,
        until: show.mh_shows_id.until,
        title: show.mh_shows_id.show.name || "Geen titel beschikbaar", //placeholder omdat er anders helemaal niks laad
        body: show.mh_shows_id.show.body || "Geen informatie beschikbaar",
        userAvatar: show.mh_shows_id.show.users?.[0]?.mh_users_id?.cover || null, //zoek de gebruiker die hoort bij de show [0] voor eerste dj
 
      })) || [];

    if (filteredShows.length === 0) { 
      return res.render('radio.liquid', {
        station,
        shows: [], 
        weekDays: [],
        selectedDay,
        timeSlots: []
      });
    }

    // Bereken tijdsloten voor de shows
    function timeToMinutes(time) {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    }
    const startTimes = filteredShows.map(show => timeToMinutes(show.from));
    const endTimes = filteredShows.map(show => timeToMinutes(show.until));
    const earliest = Math.min(...startTimes);
    const latest = Math.max(...endTimes);

    const slotDuration = 60; // 60 minuten per slot
    const totalSlots = Math.ceil((latest - earliest) / slotDuration);

    // Voor elke show: bereken de start slot index en het aantal slots (colspan)
    filteredShows.forEach(show => {
      const showStart = timeToMinutes(show.from);
      const showEnd = timeToMinutes(show.until);
      show.slotStart = Math.floor((showStart - earliest) / slotDuration);
      show.colspan = Math.ceil((showEnd - showStart) / slotDuration);
    });

    // Bouw een array met tijdlabels voor de header
    let timeSlots = [];
    for (let i = 0; i <= totalSlots; i++) {
      const minutes = earliest + i * slotDuration;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const label = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
      timeSlots.push(label);
    }

    // Bereken weekdagen (maandag t/m zaterdag)
    const today = new Date();
    const activeShow = today.getTime();

    let monday;
    if (today.getDay() === 0) {
      monday = new Date(today);
      monday.setDate(today.getDate() + 1);
    } else {
      monday = new Date(today);
      monday.setDate(today.getDate() - (today.getDay() - 1));
    }
    let weekDays = [];
    const daysOfWeek = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

    for (let day = 0; day < 6; day++) {
      let d = new Date(monday);
      d.setDate(monday.getDate() + day);
      weekDays.push({ day: daysOfWeek[day], dayNumber: d.getDate() });
    }


    const filter = encodeURIComponent(JSON.stringify({ from: "Colin" }));
    const likesForShows = await fetch(`https://fdnd-agency.directus.app/items/mh_messages?filter=${filter}`);
    const likesForShowsJSON = await likesForShows.json();

    const idsOfLikesForShows = likesForShowsJSON.data.map(like => like.for.toString());

    console.log("Liked Show IDs:", idsOfLikesForShows);


    // Render de radio-pagina met alle benodigde data
    res.render('radio.liquid', {
      station,
      // thisstation: station.name.toLowerCase().replace(/\s+/g, '%20'), 
      radiostations: radiostationsResponseJSON.data,
      shows: filteredShows,
      weekDays,
      selectedDay,
      timeSlots,
      totalSlots,
      likes: idsOfLikesForShows
    });
  } catch (error) {
    console.error("Error loading radio page:", error);
    res.status(500).send("Er is een fout opgetreden.");
  }
});

//like posten
app.post('/radio/:stationName/show/:id/like', async (req, res) => {
  console.log(req.params.id);
  try {
    const directusResponse = await fetch('https://fdnd-agency.directus.app/items/mh_messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: "❤️",
        for: req.params.id,
        from: "Colin"
      })
    });
    console.log(directusResponse);
    res.redirect(303, `/radio/${req.params.stationName}`);
  } catch (error) {
    console.error("Error posting like:", error);
    res.status(500).send("Er is een fout opgetreden bij het liken.");
  }
});

app.post('/radio/:stationName/show/:id/unlike', async (req, res) => {
  try {
    // const filter = encodeURIComponent(JSON.stringify({ from: "Colin" }));
    const likesResponse = await fetch(`https://fdnd-agency.directus.app/items/mh_messages?filter={"_and":[{"from": "Colin"},{"for": ${req.params.id}}]}`);
    const likesJSON = await likesResponse.json();

    if (likesJSON.data.length > 0) {
      const likeId = likesJSON.data[0].id;

      await fetch(`https://fdnd-agency.directus.app/items/mh_messages/${likeId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
    }

    res.redirect(303, `/radio/${req.params.stationName}`);
  } catch (error) {
    console.error("Error unliking show:", error);
    res.status(500).send("Unliken niet gelukt!");
  }
});


app.post('/radio/:stationName/show/:id/bookmark', async (req, res) => {
  try {
    
    // from en until ophalen van de gebookmarkte show om tijden mee te kunnen geven
    const showRes = await fetch(`https://fdnd-agency.directus.app/items/mh_shows/${req.params.id}?fields=from,until`);
    const showResJSON = await showRes.json();
    const { from, until } = showResJSON.data;


    const directusResponse = await fetch('https://fdnd-agency.directus.app/items/mh_messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '❤️',
        for: req.params.id,
        from: '1G',
        show_from: from, //kijken of krijn hier velden voor kan maken. Anders weet ik het ook niet
        show_until: until
      })
    });

    if (!directusResponse.ok) {
      throw new Error(`ok!`);
    }


    res.redirect(303, `/radio/${encodeURIComponent(req.params.stationName)}`);
  } catch (error) {
    console.error('Error posting like:', error);
    res.status(500).send('mislukt! :(');
  }
});


// Start de server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
