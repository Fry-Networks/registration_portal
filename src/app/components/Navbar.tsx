import React from "react";
const logo = "https://static.wixstatic.com/media/c1b522_4181d931ff1b40fea4d60841fba9523f~mv2.png/v1/fill/w_230,h_148,al_c,q_85,usm_0.66_1.00_0.01,enc_auto/Fry%20foundation.png";
const background = "https://static.wixstatic.com/media/c1b522_db6cc2be10fd4988b870c4c9426c3836~mv2.png/v1/fill/w_1512,h_328,al_c,q_90,enc_auto/c1b522_db6cc2be10fd4988b870c4c9426c3836~mv2.png";

export default function Account() {
    return (
    <div>
        <nav
            style={{
                height: '106px',
                width: '100vw',
                color: 'white',
                background: 'rgba(28, 28, 28, 0.4)',
                display: 'flex',
                alignItems: 'center',
                position: 'absolute', // Made it absolute again
                zIndex: '2' // Increase zIndex so it layers on top of the background image
            }}
        >
            <div style={{ position: 'relative', width: '115px', height: '74px', margin: '20px', marginLeft: '50px' }}>
                <img src={logo} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
        </nav>
        <div
            style={{
                zIndex: '1',
                width: '100%',
                height: '328px',
                backgroundImage: `url(${background})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                opacity: '0.6',
            }}
        >
            {/* Keep this div empty to act as pseudo element with background image */}
        </div>
    </div>
    );
}
